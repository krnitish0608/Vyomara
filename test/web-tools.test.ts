import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config/config.ts';
import { createLogger } from '../src/diagnostics/logger.ts';
import { decodeEntities, htmlToText } from '../src/shared/html-text.ts';
import { ApprovalMemory, isPrivateHost } from '../src/tools/action-tools.ts';
import type { ActionProposal, ApprovalDecision } from '../src/tools/action-tools.ts';
import { createDefaultToolRegistry } from '../src/tools/default-tools.ts';
import { ToolExecutionError, ToolExecutor } from '../src/tools/executor.ts';
import { PolicyGateway } from '../src/tools/policy.ts';
import { HttpWebClient } from '../src/tools/web-client.ts';

type Route = (url: URL) => Response;

function fakeFetch(routes: Record<string, Route>, requested: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requested.push(url.href);
    const route = routes[`${url.origin}${url.pathname}`];
    if (!route) return new Response('missing', { status: 404 });
    return route(url);
  }) as typeof fetch;
}

const html = (body: string): Response => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

function webExecutor(
  client: HttpWebClient,
  answers: ApprovalDecision[] = [true, true, true, true],
  asked: ActionProposal[] = [],
  memory = new ApprovalMemory(),
) {
  const config = loadConfig({ VYOM_PROVIDER: 'placeholder', VYOM_ALLOWED_ROOTS: '[]' });
  return new ToolExecutor({
    registry: createDefaultToolRegistry(config, {
      actions: {
        approval: { async request(action) { asked.push(action); return answers.shift() ?? false; } },
        approvalMemory: memory,
        web: client,
      },
    }),
    policy: new PolicyGateway({ allowedEffects: ['network'] }),
    config,
    logger: createLogger(() => {}),
  });
}

test('htmlToText keeps readable text, headings, lists, and absolute links; drops scripts and styles', () => {
  const page = htmlToText(`<!doctype html><html><head><title>Docs &amp; Guides</title><style>p{}</style></head>
    <body><nav><a href="/home">Home</a></nav><script>alert(1)</script>
    <h1>Install</h1><p>Run <code>pnpm add x</code>&nbsp;now.</p>
    <ul><li>One</li><li>Two &#8212; more</li></ul>
    <a href="/guide?a=1&amp;b=2">Read the guide</a> <a href="javascript:evil()">bad</a></body></html>`, 'https://example.com/docs/');
  assert.equal(page.title, 'Docs & Guides');
  assert.match(page.text, /## Install/);
  assert.match(page.text, /Run pnpm add x now\./);
  assert.match(page.text, /- One\n- Two — more/);
  assert.doesNotMatch(page.text, /alert|p\{\}|Home/);
  assert.deepEqual(page.links, [{ text: 'Read the guide', url: 'https://example.com/guide?a=1&b=2' }]);
  assert.equal(decodeEntities('&lt;a&gt; &#x41; &unknown;'), '<a> A &unknown;');
});

test('private and loopback hosts are recognised', () => {
  for (const host of ['localhost', 'api.localhost', '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.5', '169.254.169.254', '::1', '[::1]', 'fd00::1', 'printer.local']) {
    assert.equal(isPrivateHost(host), true, host);
  }
  for (const host of ['example.com', '8.8.8.8', '172.32.0.1', 'react.dev']) {
    assert.equal(isPrivateHost(host), false, host);
  }
});

test('fetch_url reads a page after approval and pages through long text', async () => {
  const long = `<title>Long</title><p>${'word '.repeat(10_000)}</p><a href="https://example.com/next">Next</a>`;
  const client = new HttpWebClient({ fetchImplementation: fakeFetch({ 'https://example.com/long': () => html(long) }) });
  const asked: ActionProposal[] = [];
  const executor = webExecutor(client, [true, true], asked);
  const first = await executor.execute('fetch_url', { url: 'https://example.com/long' }, new AbortController().signal) as {
    status: string; title: string; content: string; truncated: boolean; nextOffset: number; links: unknown[];
  };
  assert.equal(first.status, 'fetched');
  assert.equal(first.title, 'Long');
  assert.equal(first.truncated, true);
  assert.equal(first.links.length, 1);
  const second = await executor.execute('fetch_url', { url: 'https://example.com/long', offset: first.nextOffset }, new AbortController().signal) as {
    content: string; links?: unknown;
  };
  assert.ok(second.content.length > 0);
  assert.equal(second.links, undefined);
  assert.deepEqual(asked[0], { kind: 'web', operation: 'fetch', target: 'https://example.com/long', host: 'example.com' });
});

test('fetch_url refuses private addresses, including through redirects, and non-text content', async () => {
  const requested: string[] = [];
  const client = new HttpWebClient({
    fetchImplementation: fakeFetch({
      'https://example.com/redirect': () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:11434/api/tags' } }),
      'https://example.com/file.zip': () => new Response('PK', { headers: { 'content-type': 'application/zip' } }),
    }, requested),
  });
  const executor = webExecutor(client);
  await assert.rejects(
    executor.execute('fetch_url', { url: 'http://localhost:11434/' }, new AbortController().signal),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'invalid-input',
  );
  await assert.rejects(
    executor.execute('fetch_url', { url: 'https://example.com/redirect' }, new AbortController().signal),
    /local or private network/,
  );
  await assert.rejects(
    executor.execute('fetch_url', { url: 'https://example.com/file.zip' }, new AbortController().signal),
    /not a readable text page/,
  );
  assert.ok(!requested.some(url => url.includes('127.0.0.1')), 'the private redirect target is never requested');
});

test('rejected fetches download nothing; "always" skips later prompts for that host only', async () => {
  const requested: string[] = [];
  const client = new HttpWebClient({
    fetchImplementation: fakeFetch({
      'https://a.example/x': () => html('<p>a</p>'),
      'https://b.example/y': () => html('<p>b</p>'),
    }, requested),
  });
  const asked: ActionProposal[] = [];
  const executor = webExecutor(client, [false, 'always', true], asked);
  const signal = new AbortController().signal;
  assert.equal((await executor.execute('fetch_url', { url: 'https://a.example/x' }, signal) as { status: string }).status, 'rejected');
  assert.deepEqual(requested, []);
  await executor.execute('fetch_url', { url: 'https://a.example/x' }, signal);
  await executor.execute('fetch_url', { url: 'https://a.example/x?again' }, signal);
  await executor.execute('fetch_url', { url: 'https://b.example/y' }, signal);
  assert.equal(asked.length, 3, 'a.example is asked twice (reject, always), b.example once');
});

test('web_search exists only with a SearXNG backend and returns cleaned results', async () => {
  const config = loadConfig({ VYOM_PROVIDER: 'placeholder', VYOM_ALLOWED_ROOTS: '[]' });
  const withoutSearch = createDefaultToolRegistry(config, {
    actions: { approval: { async request() { return true; } }, web: new HttpWebClient({ fetchImplementation: fakeFetch({}) }) },
  });
  assert.equal(withoutSearch.get('web_search'), undefined);
  assert.ok(withoutSearch.get('fetch_url'));

  const requested: string[] = [];
  const client = new HttpWebClient({
    searxngUrl: 'http://127.0.0.1:8888',
    fetchImplementation: fakeFetch({
      'http://127.0.0.1:8888/search': url => new Response(JSON.stringify({
        query: url.searchParams.get('q'),
        results: [
          { title: 'React Native', url: 'https://reactnative.dev/', content: 'Learn once, write anywhere.' },
          { title: 'Bad', url: 'javascript:alert(1)' },
        ],
      }), { headers: { 'content-type': 'application/json' } }),
    }, requested),
  });
  const asked: ActionProposal[] = [];
  const result = await webExecutor(client, [true], asked).execute('web_search', { query: 'react native' }, new AbortController().signal);
  assert.deepEqual(result, {
    status: 'searched',
    query: 'react native',
    results: [{ title: 'React Native', url: 'https://reactnative.dev/', snippet: 'Learn once, write anywhere.' }],
  });
  assert.deepEqual(asked, [{ kind: 'web', operation: 'search', target: 'react native', host: '127.0.0.1' }]);
  assert.match(requested[0] ?? '', /format=json/);
});

test('VYOM_SEARXNG_URL is validated', () => {
  assert.equal(loadConfig({ VYOM_SEARXNG_URL: 'http://localhost:8888' }).searxngUrl, 'http://localhost:8888/');
  assert.equal(loadConfig({}).searxngUrl, undefined);
  assert.throws(() => loadConfig({ VYOM_SEARXNG_URL: 'ftp://x' }), /VYOM_SEARXNG_URL/);
  assert.throws(() => loadConfig({ VYOM_SEARXNG_URL: 'https://user:pw@x.dev' }), /VYOM_SEARXNG_URL/);
});
