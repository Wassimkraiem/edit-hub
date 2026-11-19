# local addition: VideoHub's voice input. One JSON request per line on stdin ({"path": "...", "language": null}),
# one JSON answer per line on stdout ({"text": "..."} or {"error": "..."}). The model loads once, on the first request.
import glob, json, os, subprocess, sys
import numpy as np

# the GPU libraries from pip (nvidia-cublas-cu12, nvidia-cudnn-cu12) live in site-packages/nvidia/*/bin: let Windows find them
for site in sys.path:
    for d in glob.glob(os.path.join(site, "nvidia", "*", "bin")):
        try:
            os.add_dll_directory(d)
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
        except (OSError, AttributeError):
            pass

model = None

def decode(path, ffmpeg):
    # ffmpeg decodes (the installed PyAV may not match faster-whisper's decoder): 16 kHz mono float32, as Whisper wants
    raw = subprocess.run([ffmpeg or "ffmpeg", "-nostdin", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
def load(device="cuda"):
    global model
    from faster_whisper import WhisperModel
    name = sys.argv[1] if len(sys.argv) > 1 else "large-v3"
    try:
        model = WhisperModel(name, device=device, compute_type="float16" if device == "cuda" else "int8")
    except Exception:
        if device == "cpu":
            raise
        load("cpu")

def run(req):
    segments, info = model.transcribe(decode(req["path"], req.get("ffmpeg")), language=req.get("language") or None, vad_filter=True,
                                      beam_size=5, initial_prompt=req.get("prompt") or None)
    return {"text": " ".join(s.text.strip() for s in segments).strip(), "language": info.language, "device": model.model.device}

for line in sys.stdin:
    try:
        req = json.loads(line)
        if model is None:
            load()
        # mixed languages: Whisper detects the language unless one is given
        try:
            out = run(req)
        except RuntimeError as e:
            # the GPU loads but its CUDA libraries are missing (cuBLAS/cuDNN): switch to the CPU for good
            if model.model.device != "cuda":
                raise
            load("cpu")
            out = run(req)
        print(json.dumps(out, ensure_ascii=False), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
