import AVFoundation
import Foundation
import Speech

func emit(_ type: String, _ values: [String: Any] = [:]) {
    var message = values
    message["type"] = type
    guard let data = try? JSONSerialization.data(withJSONObject: message),
          let text = String(data: data, encoding: .utf8) else { return }
    print(text)
    fflush(stdout)
}

func checkLanguage(_ code: String) {
    let recognizer = SFSpeechRecognizer(locale: Locale(identifier: code))
    emit("availability", [
        "language": code,
        "available": recognizer?.isAvailable == true && recognizer?.supportsOnDeviceRecognition == true
    ])
}

final class SpeechCapture {
    private let engine = AVAudioEngine()
    private let request = SFSpeechAudioBufferRecognitionRequest()
    private var task: SFSpeechRecognitionTask?
    private var stopped = false
    private var stopRequested = false
    private var captureStarted = false
    private var tapInstalled = false

    func start(language: String) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language)),
              recognizer.isAvailable,
              recognizer.supportsOnDeviceRecognition else {
            emit("error", ["message": "On-device speech recognition is unavailable for \(language)."])
            exit(1)
        }
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true

        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard !self.stopRequested else { self.finish(); return }
                guard status == .authorized else {
                    emit("error", ["message": "macOS speech-recognition permission was not granted."])
                    exit(1)
                }
                AVAudioApplication.requestRecordPermission { granted in
                    DispatchQueue.main.async {
                        guard !self.stopRequested else { self.finish(); return }
                        guard granted else {
                            emit("error", ["message": "Microphone permission was not granted."])
                            exit(1)
                        }
                        self.startCapture(recognizer)
                    }
                }
            }
        }
    }

    private func startCapture(_ recognizer: SFSpeechRecognizer) {
        guard !stopRequested else { finish(); return }
        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
            self.request.append(buffer)
        }
        tapInstalled = true
        task = recognizer.recognitionTask(with: request) { result, error in
            guard !self.stopped else { return }
            if let result {
                emit(result.isFinal ? "final" : "partial", ["transcript": result.bestTranscription.formattedString])
                if result.isFinal { self.finish() }
            } else if let error {
                let message = error.localizedDescription.localizedCaseInsensitiveContains("Siri and Dictation are disabled")
                    ? "macOS Dictation is turned off. Enable Dictation in System Settings > Keyboard > Dictation, then try again. Voice audio remains on this Mac."
                    : "On-device speech recognition failed: \(error.localizedDescription)"
                emit("error", ["message": message])
                self.finish()
            }
        }
        do {
            engine.prepare()
            try engine.start()
            captureStarted = true
            emit("listening")
        } catch {
            emit("error", ["message": "The microphone could not be started: \(error.localizedDescription)"])
            finish()
        }
    }

    func stop() {
        stopRequested = true
        guard captureStarted else { finish(); return }
        request.endAudio()
        task?.finish()
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { self.finish() }
    }

    private func finish() {
        guard !stopped else { return }
        stopped = true
        if engine.isRunning { engine.stop() }
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        task?.cancel()
        emit("stopped")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { exit(0) }
    }
}

if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--check" {
    checkLanguage(CommandLine.arguments[2])
} else if CommandLine.arguments.count == 2 {
    let capture = SpeechCapture()
    FileHandle.standardInput.readabilityHandler = { handle in
        let input = handle.availableData
        if input.isEmpty || String(data: input, encoding: .utf8)?.contains("stop") == true {
            DispatchQueue.main.async { capture.stop() }
        }
    }
    capture.start(language: CommandLine.arguments[1])
    RunLoop.main.run()
} else {
    emit("error", ["message": "Invalid speech-helper arguments."])
    exit(2)
}
