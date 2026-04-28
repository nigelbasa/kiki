import { useCallback, useEffect, useRef, useState } from 'react';
import { del, get, postForm } from '@shared/api/client';
import { useSocket } from './useSocket';

const EMPTY_COUNTS = { car: 0, truck: 0, bus: 0, motorcycle: 0 };
const STORAGE_KEY = 'rwendo:last-detection';

export function useDetection() {
  const { socket } = useSocket();
  const [preferUploader, setPreferUploader] = useState(false);
  const [jobId, setJobId] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}').jobId || null;
    } catch {
      return null;
    }
  });
  const [jobProgress, setJobProgress] = useState(0);
  const [jobFrame, setJobFrame] = useState(0);
  const [jobTotal, setJobTotal] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}').jobTotal || 0;
    } catch {
      return 0;
    }
  });
  const [jobComplete, setJobComplete] = useState(() => {
    try {
      return Boolean(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}').jobComplete);
    } catch {
      return false;
    }
  });
  const [jobError, setJobError] = useState(null);
  const [counts, setCounts] = useState(() => {
    try {
      return { ...EMPTY_COUNTS, ...(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}').counts || {}) };
    } catch {
      return EMPTY_COUNTS;
    }
  });
  const [durationSec, setDurationSec] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}').durationSec || 0;
    } catch {
      return 0;
    }
  });
  const jobIdRef = useRef(null);

  useEffect(() => {
    jobIdRef.current = jobId;
  }, [jobId]);

  const loadDefaultVideo = useCallback(async () => {
    try {
      const data = await get('/api/detection/default');
      setJobId(data.job_id || 'default-library-video');
      setJobProgress(1);
      setJobFrame(data.frame_idx ?? 0);
      setJobTotal(data.total_frames ?? 0);
      setJobComplete(true);
      setJobError(null);
      setCounts({ ...EMPTY_COUNTS, ...(data.counts || {}) });
      setDurationSec(data.duration_sec ?? 0);
    } catch {
      // default video is optional
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ jobId, jobTotal, jobComplete, counts, durationSec }),
      );
    } catch {
      // ignore storage failures
    }
  }, [jobId, jobTotal, jobComplete, counts, durationSec]);

  useEffect(() => {
    const onProgress = (data) => {
      if (jobIdRef.current && data.job_id !== jobIdRef.current) return;
      setJobProgress(data.progress ?? 0);
      setJobFrame(data.frame_idx ?? 0);
      setJobTotal(data.total_frames ?? 0);
      if (data.counts) {
        setCounts((current) => ({ ...current, ...data.counts }));
      }
    };

    const onComplete = (data) => {
      if (jobIdRef.current && data.job_id !== jobIdRef.current) return;
      if (data.status === 'error') {
        setJobError(data.error || 'unknown error');
        return;
      }
      setJobComplete(true);
      setJobProgress(1);
      setJobTotal(data.total_frames ?? 0);
      setDurationSec(data.duration_sec ?? 0);
      if (data.counts) {
        setCounts({ ...EMPTY_COUNTS, ...data.counts });
      }
    };

    socket.on('detection:progress', onProgress);
    socket.on('detection:complete', onComplete);
    return () => {
      socket.off('detection:progress', onProgress);
      socket.off('detection:complete', onComplete);
    };
  }, [socket]);

  useEffect(() => {
    if (!jobId || jobError) return undefined;

    let cancelled = false;
    const poll = async () => {
      try {
        const status = await get(`/api/detection/status/${jobId}`);
        if (cancelled) return;
        setJobProgress(status.progress ?? 0);
        setJobFrame(status.frame_idx ?? 0);
        setJobTotal(status.total_frames ?? 0);
        setDurationSec(status.duration_sec ?? 0);
        if (status.counts) {
          setCounts({ ...EMPTY_COUNTS, ...status.counts });
        }
        if (status.status === 'complete') {
          setJobComplete(true);
          setJobError(null);
        } else if (status.status === 'error') {
          setJobError(status.error || 'unknown error');
        } else {
          setJobComplete(false);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('detection status poll failed', error);
          if (error?.status === 404 && jobIdRef.current !== 'default-library-video') {
            setJobError('The detection job could not be found. It may have been cleared or the server may have restarted.');
          } else if (error?.status >= 400) {
            setJobError(error.message || 'Failed to load detection status');
          }
        }
      }
    };

    poll();
    if (jobComplete) {
      return () => {
        cancelled = true;
      };
    }

    const interval = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [jobId, jobComplete, jobError]);

  useEffect(() => {
    if (preferUploader) return;
    if (jobId && jobId !== 'default-library-video') return;
    loadDefaultVideo();
  }, [jobId, loadDefaultVideo, preferUploader]);

  const uploadVideo = useCallback(async (file) => {
    const formData = new FormData();
    formData.append('video', file);
    setPreferUploader(true);
    setJobComplete(false);
    setJobError(null);
    setJobProgress(0);
    setJobFrame(0);
    setJobTotal(0);
    setCounts(EMPTY_COUNTS);
    setDurationSec(0);
    const { job_id } = await postForm('/api/detection/upload', formData);
    setJobId(job_id);
    return job_id;
  }, []);

  const useCustomVideo = useCallback(() => {
    setPreferUploader(true);
    setJobId(null);
    setJobProgress(0);
    setJobFrame(0);
    setJobTotal(0);
    setJobComplete(false);
    setJobError(null);
    setCounts(EMPTY_COUNTS);
    setDurationSec(0);
  }, []);

  const reset = useCallback(() => {
    del('/api/detection/reset').catch(() => {});
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage failures
    }
    setPreferUploader(false);
    setJobId(null);
    setJobProgress(0);
    setJobFrame(0);
    setJobTotal(0);
    setJobComplete(false);
    setJobError(null);
    setCounts(EMPTY_COUNTS);
    setDurationSec(0);
    loadDefaultVideo();
  }, [loadDefaultVideo]);

  return {
    jobId,
    jobProgress,
    jobFrame,
    jobTotal,
    jobComplete,
    jobError,
    counts,
    durationSec,
    resultUrl: jobId === 'default-library-video' ? '/api/detection/default/video' : jobId ? `/api/detection/result/${jobId}` : null,
    uploadVideo,
    useCustomVideo,
    reset,
    isProcessing: Boolean(jobId && !jobComplete && !jobError),
    hasDefaultVideo: jobId === 'default-library-video',
    preferUploader,
  };
}
