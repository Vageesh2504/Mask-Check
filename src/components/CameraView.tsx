import React, { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as blazeface from '@tensorflow-models/blazeface';
import { Camera, ShieldAlert, ShieldCheck } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';

import { MaskStatus } from '../types';
import { cn } from '../lib/utils';


export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [model, setModel] = useState<blazeface.BlazeFaceModel | null>(null);
  const [status, setStatus] = useState<MaskStatus | 'detecting'>('detecting');
  const [loading, setLoading] = useState(true);
  const lastLogTimeRef = useRef(0);

  const [confidence, setConfidence] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const historyRef = useRef<MaskStatus[]>([]);
  const presenceRef = useRef<number[]>([]); // 0 for no face, 1 for face
  const streamRef = useRef<MediaStream | null>(null);
  const statusRef = useRef<MaskStatus | 'detecting'>('detecting');
  const confidenceRef = useRef(0);
  const lastUIUpdateRef = useRef(0);

  const startCamera = async () => {
    if (isActive) return;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Set canvas dimensions to match video
          videoRef.current.onloadedmetadata = () => {
            if (canvasRef.current && videoRef.current) {
              canvasRef.current.width = videoRef.current.videoWidth;
              canvasRef.current.height = videoRef.current.videoHeight;
            }
          };
        }
        setIsActive(true);
      }
    } catch (error) {
      console.error("Error starting camera:", error);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
    setStatus('detecting');
    setConfidence(0);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const analyzeMaskLocal = (ctx: CanvasRenderingContext2D, face: any) => {
    const [start, end] = face.topLeft as [number, number];
    const [sizeX, sizeY] = face.bottomRight as [number, number];
    const width = sizeX - start;
    const height = sizeY - end;

    try {
      // 1. Sample Forehead (Reference Skin)
      const foreheadData = ctx.getImageData(start + width * 0.3, end + height * 0.1, width * 0.4, height * 0.15).data;
      let refR = 0, refG = 0, refB = 0, refBright = 0;
      for (let i = 0; i < foreheadData.length; i += 4) {
        refR += foreheadData[i];
        refG += foreheadData[i + 1];
        refB += foreheadData[i + 2];
        refBright += (foreheadData[i] + foreheadData[i + 1] + foreheadData[i + 2]) / 3;
      }
      const count = foreheadData.length / 4;
      refR /= count; refG /= count; refB /= count; refBright /= count;

      // 2. Sample Mouth Area (Granular)
      const mouthData = ctx.getImageData(start + width * 0.25, end + height * 0.65, width * 0.5, height * 0.25).data;
      let mouthR = 0, mouthG = 0, mouthB = 0, mouthBright = 0;
      let skinMatchCount = 0;
      let blueTint = 0;
      let mouthVariance = 0;

      for (let i = 0; i < mouthData.length; i += 4) {
        const r = mouthData[i];
        const g = mouthData[i + 1];
        const b = mouthData[i + 2];
        const bright = (r + g + b) / 3;
        mouthR += r; mouthG += g; mouthB += b; mouthBright += bright;

        // Compare to reference skin tone
        const diff = Math.abs(r - refR) + Math.abs(g - refG) + Math.abs(b - refB);
        if (diff < 50) skinMatchCount++;

        // Medical Blue Tint
        if (b > r + 15 && b > g + 15) blueTint++;
      }
      const mouthCount = mouthData.length / 4;
      mouthR /= mouthCount; mouthG /= mouthCount; mouthB /= mouthCount; mouthBright /= mouthCount;

      // Calculate Texture Variance
      for (let i = 0; i < mouthData.length; i += 4) {
        const bright = (mouthData[i] + mouthData[i + 1] + mouthData[i + 2]) / 3;
        mouthVariance += Math.pow(bright - mouthBright, 2);
      }
      mouthVariance = Math.sqrt(mouthVariance / mouthCount);

      // 3. Heuristics
      const skinRatio = skinMatchCount / mouthCount;
      const isBlue = blueTint > mouthCount * 0.15;
      const brightnessDiff = Math.abs(mouthBright - refBright);

      // A mask is likely if:
      // - Skin ratio is low AND (it's very smooth OR significantly different brightness)
      // - OR it has a strong blue tint
      const isMask = (skinRatio < 0.4 && (mouthVariance < 20 || brightnessDiff > 35)) || isBlue;

      // Calculate a continuous mask score from 0 (definitely no mask) to 1 (definitely mask)
      // Signal 1: Skin similarity (low = likely mask)
      const skinScore = Math.max(0, Math.min(1, 1 - skinRatio)); // 0 if all skin, 1 if no skin match

      // Signal 2: Texture smoothness (low variance = likely mask)
      const textureScore = Math.max(0, Math.min(1, 1 - (mouthVariance / 50))); // smooth = high score

      // Signal 3: Brightness difference (high = likely mask)
      const brightnessScore = Math.max(0, Math.min(1, brightnessDiff / 80));

      // Signal 4: Blue tint (strong indicator)
      const blueScore = isBlue ? 1.0 : 0;

      // Weighted combination
      const maskScore = Math.min(1, (skinScore * 0.45) + (textureScore * 0.2) + (brightnessScore * 0.2) + (blueScore * 0.15));

      // Confidence is how far from 0.5 we are (closer to 0 or 1 = more confident)
      const localConf = 0.5 + Math.abs(maskScore - 0.5);

      confidenceRef.current = Math.round(localConf * 100) / 100;
      return isMask ? 'mask' : 'no_mask';
    } catch (e) {
      return 'detecting';
    }
  };


  useEffect(() => {
    async function setup() {
      await tf.ready();
      const loadedModel = await blazeface.load();
      setModel(loadedModel);
      setLoading(false);
    }
    setup();
  }, []);

  useEffect(() => {
    if (!model || !videoRef.current || !isActive) return;

    let animationId: number;

    const detect = async () => {
      if (videoRef.current && videoRef.current.readyState === 4) {
        const predictions = await model.estimateFaces(videoRef.current, false);

        if (predictions.length > 0) {
          const face = predictions[0];
          const [start, end] = face.topLeft as [number, number];
          const [sizeX, sizeY] = face.bottomRight as [number, number];

          // Draw on canvas first to sample pixels
          if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
              // Draw video to canvas (no scaling needed if canvas matches video)
              ctx.drawImage(videoRef.current, 0, 0);

              const frameResult = analyzeMaskLocal(ctx, face);
              if (frameResult !== 'detecting') {
                // Presence Smoothing: Add 1 (face present)
                presenceRef.current = [...presenceRef.current, 1].slice(-15);

                // Temporal Smoothing: Increased window to 45 frames for high stability
                historyRef.current = [...historyRef.current, frameResult as MaskStatus].slice(-45);

                const maskCount = historyRef.current.filter(s => s === 'mask').length;
                const ratio = maskCount / historyRef.current.length;

                // Hysteresis: Require very strong consensus to switch states
                let smoothedStatus = statusRef.current;
                const presenceSum = presenceRef.current.reduce((a, b) => a + b, 0);

                if (presenceSum > 8) { // Only update if face is consistently seen
                  if (ratio > 0.8) smoothedStatus = 'mask';
                  else if (ratio < 0.2) smoothedStatus = 'no_mask';
                } else {
                  smoothedStatus = 'detecting';
                }

                if (smoothedStatus !== statusRef.current && (smoothedStatus !== 'detecting' || statusRef.current !== 'detecting')) {
                  statusRef.current = smoothedStatus;
                }
              }

              // Throttled UI state sync: update React state at most every 500ms
              const now2 = Date.now();
              if (now2 - lastUIUpdateRef.current > 500) {
                lastUIUpdateRef.current = now2;
                setStatus(statusRef.current);
                setConfidence(confidenceRef.current);

                // Firestore logging
                if (now2 - lastLogTimeRef.current > 10000 && statusRef.current !== 'detecting') {
                  logDetection(statusRef.current as MaskStatus);
                  lastLogTimeRef.current = now2;
                }
              }

              // Draw UI Overlay using refs for instant access (no stale closure)
              const currentStatus = statusRef.current;
              const currentConf = confidenceRef.current;
              ctx.strokeStyle = currentStatus === 'mask' ? '#10b981' : currentStatus === 'no_mask' ? '#ef4444' : '#71717a';
              ctx.lineWidth = 6;
              ctx.strokeRect(start, end, sizeX - start, sizeY - end);

              // Draw Label Background
              ctx.fillStyle = currentStatus === 'mask' ? '#10b981' : currentStatus === 'no_mask' ? '#ef4444' : '#71717a';
              const label = currentStatus === 'detecting' ? 'SCANNING...' : currentStatus.toUpperCase().replace('_', ' ');
              const text = `${label} (${Math.round(currentConf * 100)}%)`;
              ctx.font = 'bold 20px Inter';
              const textWidth = ctx.measureText(text).width;
              ctx.fillRect(start, end > 35 ? end - 35 : end, textWidth + 20, 30);

              ctx.fillStyle = '#ffffff';
              ctx.fillText(text, start + 10, end > 35 ? end - 12 : end + 22);
            }
          }
        } else {
          // Presence Smoothing: Add 0 (no face)
          presenceRef.current = [...presenceRef.current, 0].slice(-15);
          const presenceSum = presenceRef.current.reduce((a, b) => a + b, 0);

          if (presenceSum < 4 && statusRef.current !== 'detecting') { // Only set detecting if face is truly gone
            statusRef.current = 'detecting';
            setStatus('detecting');
            if (canvasRef.current) {
              const ctx = canvasRef.current.getContext('2d');
              ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            }
          }
        }
      }
      animationId = requestAnimationFrame(detect);
    };

    detect();
    return () => cancelAnimationFrame(animationId);
  }, [model, isActive]);

  const logDetection = async (maskStatus: MaskStatus) => {
    if (!auth.currentUser) return;

    try {
      // Use a unique ID to avoid any potential "Document already exists" errors
      const logId = `${auth.currentUser.uid}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      await setDoc(doc(db, 'logs', logId), {
        userId: auth.currentUser.uid,
        userName: auth.currentUser.displayName || auth.currentUser.email,
        status: maskStatus,
        timestamp: serverTimestamp(),
        location: 'Main Entrance - Camera 01',
        confidence,
        method: 'LOCAL_HEURISTIC'
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'logs');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 space-y-6">
      <div className="flex items-center space-x-4 mb-2">
        {!isActive ? (
          <button
            onClick={startCamera}
            disabled={loading}
            className="flex items-center px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold shadow-lg transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50"
          >
            <Camera className="w-5 h-5 mr-2" />
            START CAMERA
          </button>
        ) : (
          <button
            onClick={stopCamera}
            className="flex items-center px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold shadow-lg transition-all transform hover:scale-105 active:scale-95"
          >
            <ShieldAlert className="w-5 h-5 mr-2" />
            STOP CAMERA
          </button>
        )}
      </div>

      <div className="relative w-full max-w-2xl overflow-hidden bg-black rounded-2xl shadow-2xl aspect-video border-4 border-zinc-800">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 text-white space-y-4">
            <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="font-medium animate-pulse">Initializing AI Models...</p>
          </div>
        )}
        {!isActive && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/80 text-white space-y-4 z-10">
            <Camera className="w-16 h-16 text-zinc-600" />
            <p className="text-zinc-400 font-medium">Camera is currently offline</p>
          </div>
        )}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />

        <div className="absolute top-4 left-4 flex items-center space-x-2 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
          <div className={cn("w-2 h-2 rounded-full animate-pulse", status === 'mask' ? 'bg-emerald-500' : status === 'no_mask' ? 'bg-red-500' : 'bg-zinc-400')} />
          <span className="text-xs font-medium text-white uppercase tracking-wider">
            {status === 'detecting' ? 'Scanning...' : status.replace('_', ' ')}
          </span>
        </div>


      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-2xl">
        <StatusCard
          icon={<ShieldCheck className="w-5 h-5 text-emerald-500" />}
          label="Mask Detected"
          active={status === 'mask'}
          color="emerald"
        />
        <StatusCard
          icon={<ShieldAlert className="w-5 h-5 text-red-500" />}
          label="No Mask"
          active={status === 'no_mask'}
          color="red"
        />
        <StatusCard
          icon={<Camera className="w-5 h-5 text-blue-500" />}
          label="Camera Active"
          active={!loading}
          color="blue"
        />
      </div>
    </div>
  );
}

function StatusCard({ icon, label, active, color }: { icon: React.ReactNode, label: string, active: boolean, color: 'emerald' | 'red' | 'blue' }) {
  const colors = {
    emerald: active ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-zinc-900/50 border-zinc-800',
    red: active ? 'bg-red-500/10 border-red-500/50' : 'bg-zinc-900/50 border-zinc-800',
    blue: active ? 'bg-blue-500/10 border-blue-500/50' : 'bg-zinc-900/50 border-zinc-800',
  };

  return (
    <div className={cn("flex items-center p-4 rounded-xl border transition-all duration-300", colors[color])}>
      <div className="mr-3">{icon}</div>
      <span className={cn("text-sm font-semibold", active ? 'text-white' : 'text-zinc-500')}>
        {label}
      </span>
    </div>
  );
}
