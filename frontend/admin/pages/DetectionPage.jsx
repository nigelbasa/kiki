import { useMemo, useState } from 'react';
import { api } from '@shared/api/client';

function formatCount(value) {
  return Intl.NumberFormat().format(value || 0);
}

function formatDuration(seconds) {
  if (!seconds) return '0.0s';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function IdleState({ file, onSelect, onStart, busy }) {
  return (
    <div className="mx-auto max-w-3xl rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-3xl font-bold text-slate-900">Vehicle Detection Demo</h1>
      <p className="mt-2 max-w-xl text-sm text-slate-600">
        Upload a traffic video to detect and annotate vehicles with bounding boxes.
      </p>

      <label className="mt-8 flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-[24px] border-2 border-dashed border-slate-300 bg-slate-50 px-6 text-center transition hover:border-rwendo-accent hover:bg-orange-50">
        <input
          type="file"
          accept=".mp4,.avi,.mov,video/mp4,video/avi,video/quicktime"
          className="hidden"
          onChange={(event) => onSelect(event.target.files?.[0] || null)}
        />
        <div className="text-lg font-semibold text-slate-800">
          Drop video here or click to browse
        </div>
        <div className="mt-2 text-sm text-slate-500">
          Accepts: .mp4 .avi .mov - max 200MB
        </div>
        {file && (
          <div className="mt-4 rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white">
            {file.name}
          </div>
        )}
      </label>

      <div className="mt-6 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
        Model: YOLOv11n · Classes: car, truck, bus, motorcycle
      </div>

      <div className="mt-8 flex justify-end">
        <button
          disabled={!file || busy}
          onClick={onStart}
          className="rounded-full bg-rwendo-accent px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start Detection
        </button>
      </div>
    </div>
  );
}

function ProcessingState({ progress, frame, total }) {
  const percent = Math.max(0, Math.min(100, (progress || 0) * 100));
  const fps = frame > 0 ? Math.max(1, Math.round(frame / Math.max(progress || 0.01, 0.01) / 100)) : 0;

  return (
    <div className="mx-auto max-w-3xl rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-3xl font-bold text-slate-900">Detecting vehicles...</h1>
      <progress
        max="100"
        value={percent}
        className="mt-8 h-5 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-slate-200 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-rwendo-accent"
      />
      <div className="mt-4 text-sm text-slate-600">
        frame {formatCount(frame)} of {formatCount(total || 0)}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{percent.toFixed(1)}%</div>
      <div className="mt-6 text-sm text-slate-500">YOLOv11n processing at ~{fps} fps</div>
    </div>
  );
}

function DoneState({ videoUrl, counts, totalFrames, durationSec, onReset, title }) {
  const totalDetections = Object.values(counts).reduce((sum, value) => sum + (value || 0), 0);

  return (
    <div className="mx-auto max-w-5xl rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-3xl font-bold text-slate-900">{title || 'Detection complete'}</h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-black">
          <video
            controls
            src={api.fileUrl(videoUrl)}
            className="aspect-video w-full"
          />
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
            Summary
          </div>
          <div className="mt-4 space-y-3 text-sm text-slate-700">
            <div className="flex items-center justify-between">
              <span>Cars</span>
              <span className="font-semibold">{formatCount(counts.car)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Trucks</span>
              <span className="font-semibold">{formatCount(counts.truck)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Buses</span>
              <span className="font-semibold">{formatCount(counts.bus)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Motos</span>
              <span className="font-semibold">{formatCount(counts.motorcycle)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 pt-3">
              <span>Total</span>
              <span className="font-semibold">{formatCount(totalDetections)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Frames</span>
              <span className="font-semibold">{formatCount(totalFrames)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Duration</span>
              <span className="font-semibold">{formatDuration(durationSec)}</span>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={onReset}
        className="mt-8 rounded-full border border-rwendo-accent px-5 py-2.5 text-sm font-semibold text-rwendo-accent transition hover:bg-rwendo-accent hover:text-white"
      >
        Detect another video
      </button>
    </div>
  );
}

export default function DetectionPage({ detection }) {
  const [file, setFile] = useState(null);
  const {
    jobId,
    jobProgress,
    jobFrame,
    jobTotal,
    jobComplete,
    jobError,
    counts,
    durationSec,
    resultUrl,
    uploadVideo,
    reset,
    isProcessing,
    hasDefaultVideo,
  } = detection;

  const status = useMemo(() => {
    if (isProcessing) return 'processing';
    if (jobComplete && resultUrl) return 'done';
    return 'idle';
  }, [isProcessing, jobComplete, resultUrl]);

  async function startDetection() {
    if (!file) return;
    try {
      await uploadVideo(file);
    } catch (error) {
      alert(`Upload failed: ${error.message}`);
    }
  }

  function resetAll() {
    setFile(null);
    reset();
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-100 px-6 py-8">
      {jobError && (
        <div className="mx-auto mb-6 max-w-3xl rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Error: {jobError}
        </div>
      )}

      {status === 'idle' && (
        <IdleState file={file} onSelect={setFile} onStart={startDetection} busy={isProcessing} />
      )}
      {status === 'processing' && (
        <ProcessingState progress={jobProgress} frame={jobFrame} total={jobTotal} />
      )}
      {status === 'done' && resultUrl && (
        <DoneState
          videoUrl={resultUrl}
          counts={counts}
          totalFrames={jobTotal}
          durationSec={durationSec}
          onReset={resetAll}
          title={hasDefaultVideo ? 'Bundled annotated video' : 'Detection complete'}
        />
      )}
    </div>
  );
}
