import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationLaunchApprovalManager } from '../src/desktop/application-launch-approval.ts';
import type { DesktopApplicationLaunchProposal } from '../src/desktop/contracts.ts';
import { OperationStoppedError } from '../src/shared/bounded.ts';

test('application launch proceeds only after approval for its active proposal', async () => {
  let proposal: DesktopApplicationLaunchProposal | undefined;
  const approvals = new ApplicationLaunchApprovalManager({
    onProposal(value) {
      proposal = value;
    },
  });
  const decision = approvals.request('calculator', new AbortController().signal);

  assert.ok(proposal);
  assert.equal(proposal.application, 'calculator');
  approvals.approve(proposal.id);

  assert.equal(await decision, true);
});

test('application launch rejection resolves without granting approval', async () => {
  let proposal: DesktopApplicationLaunchProposal | undefined;
  const approvals = new ApplicationLaunchApprovalManager({
    onProposal(value) {
      proposal = value;
    },
  });
  const decision = approvals.request('safari', new AbortController().signal);

  assert.ok(proposal);
  assert.equal(proposal.application, 'safari');
  approvals.reject(proposal.id);

  assert.equal(await decision, false);
});

test('cancelled launch proposals reject and cannot later be approved', async () => {
  let proposal: DesktopApplicationLaunchProposal | undefined;
  const approvals = new ApplicationLaunchApprovalManager({
    onProposal(value) {
      proposal = value;
    },
  });
  const controller = new AbortController();
  const decision = approvals.request('terminal', controller.signal);

  controller.abort();

  assert.ok(proposal);
  const proposalId = proposal.id;
  await assert.rejects(
    decision,
    (error: unknown) => error instanceof OperationStoppedError && error.reason === 'cancelled',
  );
  assert.throws(() => approvals.approve(proposalId), /no longer active/);
});
