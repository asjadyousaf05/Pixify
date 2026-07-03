import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ImageFile, Job, PipelineSettings, PipelineStep } from '@/types';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { vaultService } from '@/services/vault.service';
import { useToast } from '@/hooks/use-toast';

interface JobContextType {
  currentJob: Job | null;
  isProcessing: boolean;
  startJob: (image: ImageFile, settings: PipelineSettings) => void;
  startOldPhotoRestoration: (image: ImageFile, settings: PipelineSettings) => void;
  cancelJob: () => void;
  clearJob: () => void;
  markPromptDismissed: () => void;
}

const JobContext = createContext<JobContextType | null>(null);
const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
const API_BASE_URL = rawApiBaseUrl ? rawApiBaseUrl.replace(/\/+$/, '') : '';

interface BackendJobData {
  status?: string;
  step?: string;
  progress?: number | string;
  iterations?: number | string;
  metrics?: {
    psnr?: number;
    ssim?: number;
  };
  outputs?: {
    enhanced_url?: string;
    bg_url?: string;
    encrypted_url?: string;
  };
  old_photo_mode?: Job['oldPhotoMode'];
  warnings?: string[];
  used_fallback?: boolean;
  stages_completed?: string[];
  models_used?: string[];
  model_failures?: string[];
  output_changed?: boolean;
  no_meaningful_change?: boolean;
  stage_timings?: Record<string, number>;
  last_heartbeat?: string;
  step_started_at?: string;
  debug?: Job['debug'];
  mask_coverage?: number;
  mask_coverage_total?: number;
  mask_coverage_central?: number;
  destructive_stage_detected?: boolean;
  destructive_output_prevented?: boolean;
  destructive_stage_prevented?: boolean;
  used_safe_fallback?: boolean;
  used_deblur?: boolean;
  used_denoise_fallback?: boolean;
  used_inpainting?: boolean;
  used_enhancement?: boolean;
  used_face_recovery?: boolean;
  final_stage_selected?: string;
  model_availability?: Record<string, boolean>;
  stages_run?: string[];
  stages_skipped?: string[];
  stages_rejected?: string[];
  mode?: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Unexpected error while uploading image';
}

function resolveOldPhotoFlags(oldPhoto: PipelineSettings['oldPhoto']) {
  const mode = oldPhoto.mode || 'repair_only';
  const face = oldPhoto.faceRestoration || mode === 'repair_face';
  const upscale = oldPhoto.upscaleEnabled || mode === 'repair_upscale';
  const colorize = oldPhoto.colorize || mode === 'repair_colorize';
  return {
    mode,
    face,
    upscale,
    colorize,
    inpaint: !!oldPhoto.repairBroken,
  };
}

function createSteps(settings: PipelineSettings): PipelineStep[] {
  const steps: PipelineStep[] = [
    { id: 'upload', name: 'Uploading', status: 'pending', progress: 0 },
  ];

  if (settings.oldPhoto.enabled) {
    const flags = resolveOldPhotoFlags(settings.oldPhoto);
    steps.push({ id: 'normalize', name: 'Preprocess', status: 'pending', progress: 0 });
    if (flags.inpaint) {
      steps.push({ id: 'inpaint', name: 'Repairing Damage', status: 'pending', progress: 0 });
    }
    steps.push({ id: 'restore', name: 'Restoring', status: 'pending', progress: 0 });
    if (flags.face) {
      steps.push({ id: 'face', name: 'Face Recovery', status: 'pending', progress: 0 });
    }
    if (flags.upscale) {
      steps.push({ id: 'upscale', name: 'Upscaling', status: 'pending', progress: 0 });
    }
    if (flags.colorize) {
      steps.push({ id: 'colorize', name: 'Colorizing', status: 'pending', progress: 0 });
    }
    steps.push({ id: 'evaluate', name: 'Evaluating', status: 'pending', progress: 0 });
  }

  if (settings.enhancement.enabled) {
    if (settings.enhancement.restoreEnabled) {
      steps.push({ id: 'restore', name: 'Restoring', status: 'pending', progress: 0 });
    }
    steps.push({ id: 'enhance', name: 'Enhancing', status: 'pending', progress: 0 });
    steps.push({ id: 'evaluate', name: 'Evaluating', status: 'pending', progress: 0 });
  }

  if (settings.background.enabled) {
    steps.push({ id: 'segment', name: 'Segmenting', status: 'pending', progress: 0 });
    if (settings.background.action === 'replace') {
      steps.push({ id: 'replace', name: 'Background Replace', status: 'pending', progress: 0 });
    }
  }

  if (settings.security.enabled) {
    steps.push({ id: 'encrypt', name: 'Encrypting', status: 'pending', progress: 0 });
  }

  steps.push({ id: 'ready', name: 'Ready', status: 'pending', progress: 0 });
  return steps;
}

function toAbsoluteUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${API_BASE_URL}${url}`;
}

function withCacheBust(url: string | undefined, key: string): string | undefined {
  if (!url) return undefined;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(key)}`;
}

function mapBackendStep(step: string | undefined): PipelineStep['id'] {
  switch (step) {
    case 'uploading':
    case 'loading':
      return 'upload';
    case 'normalizing':
      return 'normalize';
    case 'inpainting':
      return 'inpaint';
    case 'enhancing':
      return 'enhance';
    case 'upscaling':
      return 'upscale';
    case 'restoring':
      return 'restore';
    case 'colorizing':
      return 'colorize';
    case 'face_recovery':
      return 'face';
    case 'evaluating':
    case 'saving':
      return 'evaluate';
    case 'segmenting':
      return 'segment';
    case 'compositing':
      return 'replace';
    case 'encrypting':
      return 'encrypt';
    default:
      return 'ready';
  }
}

function resolveBackgroundMode(settings: PipelineSettings): { mode: 'transparent' | 'solid' | 'blur' | 'custom'; solidColor: string } {
  const solidColor = settings.background.color || '#ffffff';
  if (!settings.background.enabled) {
    return { mode: 'transparent', solidColor };
  }

  if (settings.background.action === 'remove') {
    return {
      mode: settings.background.type === 'blur' ? 'blur' : 'transparent',
      solidColor,
    };
  }

  if (settings.background.type === 'custom') {
    return { mode: 'custom', solidColor };
  }

  if (settings.background.type === 'solid') {
    return { mode: 'solid', solidColor };
  }

  if (settings.background.type === 'preset') {
    const presetColorMap: Record<string, string> = {
      'gradient-1': '#667eea',
      'gradient-2': '#f5576c',
      'gradient-3': '#4facfe',
      'gradient-4': '#a8edea',
      'solid-white': '#ffffff',
      'solid-black': '#000000',
      'solid-gray': '#6b7280',
      'solid-blue': '#3b82f6',
    };

    return {
      mode: 'solid',
      solidColor: presetColorMap[settings.background.presetId || 'solid-white'] || '#ffffff',
    };
  }

  // Safety fallback for stale UI state when switching between remove/replace tabs.
  return { mode: 'solid', solidColor };
}

export function JobProvider({ children }: { children: React.ReactNode }) {
  const { addProcessedVersion, onImageRemovedRef } = useWorkspace();
  const { user } = useAuth();
  const { toast } = useToast();
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalizedJobRef = useRef<string | null>(null);
  const jobImageIdRef = useRef<string | null>(null);

  const clearPolling = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  // Register auto-cancel callback with WorkspaceContext
  useEffect(() => {
    onImageRemovedRef.current = (removedImageId: string) => {
      if (jobImageIdRef.current === removedImageId) {
        // The image that owns the current job was closed — cancel it
        processingRef.current = false;
        clearPolling();
        setIsProcessing(false);
        setCurrentJob(null);
        jobImageIdRef.current = null;
        finalizedJobRef.current = null;
      }
    };
    return () => {
      onImageRemovedRef.current = null;
    };
  }, [onImageRemovedRef, clearPolling]);

  const resolveUploadFile = useCallback(async (image: ImageFile): Promise<File> => {
    if (image.file instanceof File) {
      return image.file;
    }

    const response = await fetch(image.url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load selected image source (${response.status})`);
    }

    const blob = await response.blob();
    return new File([blob], image.name || 'upload.png', {
      type: blob.type || image.format || 'image/png',
      lastModified: Date.now(),
    });
  }, []);

  const applyJobData = useCallback((prev: Job | null, data: BackendJobData, backendJobId: string) => {
    if (!prev) return null;

    const stepsUpdated = prev.steps.map(step => ({ ...step }));
    const mappedStepId = mapBackendStep(typeof data.step === 'string' ? data.step : undefined);
    const currentIdx = stepsUpdated.findIndex(step => step.id === mappedStepId);
    stepsUpdated.forEach((stepItem, idx) => {
      if (data.status === 'failed') {
        if (idx === Math.max(0, currentIdx)) {
          stepItem.status = 'failed';
        } else if (stepItem.status === 'pending') {
          stepItem.status = 'skipped';
        }
      } else if (idx < currentIdx) {
        stepItem.status = 'completed';
        stepItem.progress = 100;
      } else if (idx === currentIdx && data.status !== 'done') {
        stepItem.status = 'processing';
        stepItem.progress = Math.min(100, Math.max(0, Number(data.progress || 0)));
      } else if (data.status === 'done') {
        stepItem.status = 'completed';
        stepItem.progress = 100;
      }
    });

    const artifactVersion = data.status === 'done'
      ? `${backendJobId}-${String(data.last_heartbeat || data.step_started_at || Date.now())}`
      : backendJobId;

    return {
      ...prev,
      status: data.status === 'done' ? 'completed' : data.status === 'failed' ? 'failed' : 'pending',
      progress: Number(data.progress || 0),
      currentStepIndex: Math.max(0, currentIdx),
      steps: stepsUpdated,
      iterations: Number(data.iterations || 0),
      metrics: {
        psnr: data.metrics?.psnr ?? undefined,
        ssim: data.metrics?.ssim ?? undefined,
        encryptionSuccess: !!data.outputs?.encrypted_url,
      },
      oldPhotoMode: typeof data.old_photo_mode === 'string' ? data.old_photo_mode : undefined,
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
      usedFallback: !!data.used_fallback,
      stagesCompleted: Array.isArray(data.stages_completed) ? data.stages_completed : [],
      modelsUsed: Array.isArray(data.models_used) ? data.models_used : [],
      modelFailures: Array.isArray(data.model_failures) ? data.model_failures : [],
      outputChanged: typeof data.output_changed === 'boolean' ? data.output_changed : null,
      noMeaningfulChange: !!data.no_meaningful_change,
      stageTimings: data.stage_timings ?? {},
      lastHeartbeat: data.last_heartbeat ?? undefined,
      stepStartedAt: data.step_started_at ?? undefined,
      debug: data.debug ?? undefined,
      maskCoverage: typeof data.mask_coverage === 'number' ? data.mask_coverage : null,
      maskCoverageTotal: typeof data.mask_coverage_total === 'number' ? data.mask_coverage_total : null,
      maskCoverageCentral: typeof data.mask_coverage_central === 'number' ? data.mask_coverage_central : null,
      destructiveStageDetected: !!data.destructive_stage_detected,
      destructiveOutputPrevented: !!data.destructive_output_prevented,
      destructiveStagePrevented: !!data.destructive_stage_prevented,
      usedSafeFallback: !!data.used_safe_fallback,
      usedDeblur: !!data.used_deblur,
      usedDenoiseFallback: !!data.used_denoise_fallback,
      usedInpainting: !!data.used_inpainting,
      usedEnhancement: !!data.used_enhancement,
      usedFaceRecovery: !!data.used_face_recovery,
      finalStageSelected: typeof data.final_stage_selected === 'string' ? data.final_stage_selected : undefined,
      modelAvailability: data.model_availability ?? {},
      stagesRun: Array.isArray(data.stages_run) ? data.stages_run : [],
      stagesSkipped: Array.isArray(data.stages_skipped) ? data.stages_skipped : [],
      stagesRejected: Array.isArray(data.stages_rejected) ? data.stages_rejected : [],
      enhancedImageUrl: withCacheBust(toAbsoluteUrl(data.outputs?.enhanced_url), artifactVersion),
      backgroundEditedUrl: withCacheBust(toAbsoluteUrl(data.outputs?.bg_url), artifactVersion),
      encryptedPackageUrl: withCacheBust(toAbsoluteUrl(data.outputs?.encrypted_url), artifactVersion),
      updatedAt: new Date(),
      completedAt: data.status === 'done' ? new Date() : prev.completedAt,
    };
  }, []);

  const beginJob = useCallback((image: ImageFile, settings: PipelineSettings): Job => ({
    id: `job-${Date.now()}`,
    status: 'pending',
    steps: createSteps(settings),
    currentStepIndex: 0,
    progress: 0,
    settings,
    originalImage: image,
    warnings: [],
    stagesCompleted: [],
    modelsUsed: [],
    modelFailures: [],
    promptDismissed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }), []);

  const finalizeFailure = useCallback(() => {
    processingRef.current = false;
    setIsProcessing(false);
    clearPolling();
    setCurrentJob(prev => prev ? {
      ...prev,
      status: 'failed',
      updatedAt: new Date(),
      steps: prev.steps.map((step, i) => i === prev.currentStepIndex ? { ...step, status: 'failed' } : step),
    } : prev);
  }, [clearPolling]);

  const startPolling = useCallback((backendJobId: string, image: ImageFile, preferBackgroundOutput: boolean) => {
    const poll = async () => {
      if (!processingRef.current) return;

      try {
        const statusRes = await fetch(`${API_BASE_URL}/api/jobs/${backendJobId}`, { cache: 'no-store' });
        if (!statusRes.ok) {
          throw new Error(`Failed to fetch job status (${statusRes.status})`);
        }

        const data = await statusRes.json();
        let updatedJob: Job | null = null;
        setCurrentJob(prev => {
          updatedJob = applyJobData(prev, data, backendJobId);
          return updatedJob;
        });

        if (data.status === 'done' || data.status === 'failed') {
          if (data.status === 'done' && finalizedJobRef.current !== backendJobId) {
            finalizedJobRef.current = backendJobId;
            const artifactVersion = `${backendJobId}-${String(data.last_heartbeat || data.step_started_at || Date.now())}`;
            const processedUrl = preferBackgroundOutput
              ? withCacheBust(toAbsoluteUrl(data.outputs?.bg_url || data.outputs?.enhanced_url), artifactVersion)
              : withCacheBust(toAbsoluteUrl(data.outputs?.enhanced_url || data.outputs?.bg_url), artifactVersion);
            if (processedUrl) {
              const sourceName = image.name.replace(/\.[^.]+$/, '');
              const usingBackground = !!data.outputs?.bg_url && preferBackgroundOutput;
              const resultName = usingBackground
                ? `${sourceName}-bg.png`
                : preferBackgroundOutput
                  ? `${sourceName}-enhanced.png`
                  : `${sourceName}-restored.png`;
              addProcessedVersion(processedUrl, {
                name: resultName,
                sourceJobId: backendJobId,
                operation: usingBackground ? 'background-replaced' : 'enhanced',
              });
              if (data.mode === 'old_photo') {
                toast({
                  title: 'Old Photo AI Complete! 🎉',
                  description: 'Tip: For ultra-crisp results, try running this newly colored image through the standard "Enhancement" tab!',
                  duration: 6000,
                });
              }
              
              // Persist fully completed job to Vault cache
              if (user && updatedJob) {
                vaultService.addToVault(user.id, updatedJob).catch(console.error);
              }
            }
          }

          processingRef.current = false;
          setIsProcessing(false);
          clearPolling();
          return;
        }

        pollTimeoutRef.current = setTimeout(poll, 1500);
      } catch (error) {
        const message = getErrorMessage(error);
        toast({
          title: 'Processing failed',
          description: message,
          variant: 'destructive',
        });
        finalizeFailure();
      }
    };

    pollTimeoutRef.current = setTimeout(poll, 800);
  }, [addProcessedVersion, applyJobData, clearPolling, finalizeFailure, toast]);

  const startJob = useCallback((image: ImageFile, settings: PipelineSettings) => {
    if (processingRef.current) return;

    clearPolling();
    processingRef.current = true;
    setIsProcessing(true);
    jobImageIdRef.current = image.id;
    setCurrentJob(beginJob(image, settings));

    const run = async () => {
      try {
        console.log('[JobContext] Starting job upload...', { image: image.name, hasFile: !!image.file, url: image.url });
        const uploadFile = await resolveUploadFile(image);
        const formData = new FormData();
        formData.append('file', uploadFile, uploadFile.name);
        formData.append('mode', 'general');

        const upscale = settings.enhancement.mode === 'upscale2x' ? 2 : 4;
        const restoreEnabled = settings.enhancement.enabled && (settings.enhancement.restoreEnabled ?? true);
        const restoreMode = settings.enhancement.restoreMode || 'auto';
        const { mode: bgMode, solidColor } = resolveBackgroundMode(settings);
        const normalizedSolidColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(solidColor)
          ? solidColor
          : '#ffffff';

        if (settings.background.enabled && bgMode === 'custom' && !settings.background.customImageUrl) {
          throw new Error('Please upload a custom background image before starting replacement.');
        }

        formData.append('enhance', String(settings.enhancement.enabled));
        formData.append('upscale', String(upscale));
        formData.append('quality', settings.enhancement.quality || 'high');
        formData.append('denoise_strength', String(settings.enhancement.denoiseStrength ?? 70));
        formData.append('deblur_strength', String(settings.enhancement.deblurStrength ?? 70));
        formData.append('restore', String(restoreEnabled));
        formData.append('restore_mode', restoreMode);
        formData.append('portrait_mode', String(settings.enhancement.faceRestoration ?? true));
        formData.append('face_strength', String(75));
        formData.append('ultra', String(true));
        formData.append('remove_bg', String(settings.background.enabled));
        formData.append('bg_mode', String(bgMode));
        formData.append('solid_color', normalizedSolidColor);
        formData.append('encrypt', String(settings.security.enabled));
        if (settings.security.enabled && settings.security.password) {
          formData.append('password', settings.security.password);
        }

        if (settings.background.enabled && bgMode === 'custom' && settings.background.customImageUrl) {
          const customResponse = await fetch(settings.background.customImageUrl, { cache: 'no-store' });
          if (!customResponse.ok) {
            throw new Error('Failed to read the selected custom background image. Please re-select it.');
          }
          const customBlob = await customResponse.blob();
          if (!customBlob.size) {
            throw new Error('Selected custom background image is empty. Please choose another image.');
          }
          formData.append('custom_bg', customBlob, 'custom-background.png');
        }

        console.log('[JobContext] Sending upload to:', `${API_BASE_URL}/api/jobs`, {
          uploadName: uploadFile.name,
          uploadSize: uploadFile.size,
          uploadType: uploadFile.type,
        });
        const createRes = await fetch(`${API_BASE_URL}/api/jobs`, {
          method: 'POST',
          body: formData,
        });
        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({}));
          throw new Error(err?.detail || `Failed to create processing job (${createRes.status})`);
        }

        const created = await createRes.json();
        const backendJobId = String(created.job_id);
        setCurrentJob(prev => prev ? { ...prev, id: backendJobId } : prev);
        startPolling(backendJobId, image, true);
      } catch (error) {
        const message = getErrorMessage(error);
        toast({
          title: 'Upload failed',
          description: message,
          variant: 'destructive',
        });
        finalizeFailure();
      }
    };

    void run();
  }, [beginJob, clearPolling, finalizeFailure, resolveUploadFile, startPolling, toast]);

  const startOldPhotoRestoration = useCallback((image: ImageFile, settings: PipelineSettings) => {
    if (processingRef.current) return;

    clearPolling();
    processingRef.current = true;
    setIsProcessing(true);
    jobImageIdRef.current = image.id;

    const forcedSettings: PipelineSettings = {
      ...settings,
      enhancement: {
        ...settings.enhancement,
        enabled: false,
        restoreEnabled: false,
      },
      oldPhoto: {
        ...settings.oldPhoto,
        enabled: true,
      },
      background: { ...settings.background, enabled: false },
      security: { ...settings.security, enabled: false },
    };

    setCurrentJob(beginJob(image, forcedSettings));

    const run = async () => {
      try {
        const uploadFile = await resolveUploadFile(image);
        if (!uploadFile.size) {
          throw new Error('Selected old-photo file is empty');
        }
        console.log('[JobContext] Starting old-photo upload...', {
          sourceName: image.name,
          sourceHasFile: !!image.file,
          uploadName: uploadFile.name,
          uploadSize: uploadFile.size,
          uploadType: uploadFile.type,
          sourceUrl: image.url,
        });

        const oldPhotoFlags = resolveOldPhotoFlags(forcedSettings.oldPhoto);
        const oldPhotoUpscaleFactor = forcedSettings.oldPhoto.upscaleFactor || 2;

        const formData = new FormData();
        formData.append('file', uploadFile, uploadFile.name);
        formData.append('mode', 'old_photo');
        formData.append('old_photo_mode', oldPhotoFlags.mode);
        formData.append('old_photo_upscale', String(!!oldPhotoFlags.upscale));
        formData.append('old_photo_upscale_factor', String(oldPhotoUpscaleFactor));
        formData.append('enhance', 'true');
        formData.append('upscale', String(oldPhotoUpscaleFactor));
        formData.append('quality', 'high');
        formData.append('restore', 'true');
        formData.append('restore_mode', forcedSettings.oldPhoto.restoreMode || 'auto');
        formData.append('portrait_mode', String(!!oldPhotoFlags.face));
        formData.append('remove_bg', 'false');
        formData.append('bg_mode', 'transparent');
        formData.append('solid_color', '#ffffff');
        formData.append('encrypt', 'false');
        formData.append('colorize', String(!!oldPhotoFlags.colorize));
        formData.append('repair_broken', String(!!forcedSettings.oldPhoto.repairBroken));
        formData.append('auto_mask_damage', String(!!forcedSettings.oldPhoto.autoMaskDamage));
        formData.append('face_strength', String(forcedSettings.oldPhoto.faceStrength));
        formData.append('ultra', String(false));
        formData.append('denoise_strength', String(forcedSettings.oldPhoto.denoiseStrength));
        formData.append('deblur_strength', String(forcedSettings.oldPhoto.deblurStrength));
        formData.append('debug_stage_saves', String(true));

        const createRes = await fetch(`${API_BASE_URL}/api/jobs`, {
          method: 'POST',
          body: formData,
        });
        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({}));
          throw new Error(err?.detail || 'Failed to create old photo restoration job');
        }

        const created = await createRes.json();
        const backendJobId = String(created.job_id);
        setCurrentJob(prev => prev ? { ...prev, id: backendJobId } : prev);
        startPolling(backendJobId, image, false);
      } catch (error) {
        const message = getErrorMessage(error);
        toast({
          title: 'Old Photo upload failed',
          description: message,
          variant: 'destructive',
        });
        finalizeFailure();
      }
    };

    void run();
  }, [beginJob, clearPolling, finalizeFailure, resolveUploadFile, startPolling, toast]);

  const cancelJob = useCallback(() => {
    processingRef.current = false;
    clearPolling();
    setIsProcessing(false);
    jobImageIdRef.current = null;
    setCurrentJob(prev => prev ? { ...prev, status: 'cancelled', updatedAt: new Date() } : prev);
  }, [clearPolling]);

  const clearJob = useCallback(() => {
    processingRef.current = false;
    finalizedJobRef.current = null;
    jobImageIdRef.current = null;
    clearPolling();
    setIsProcessing(false);
    setCurrentJob(null);
  }, [clearPolling]);

  const markPromptDismissed = useCallback(() => {
    setCurrentJob(prev => prev ? {
      ...prev,
      promptDismissed: true,
      updatedAt: new Date(),
    } : prev);
  }, []);

  return (
    <JobContext.Provider value={{ currentJob, isProcessing, startJob, startOldPhotoRestoration, cancelJob, clearJob, markPromptDismissed }}>
      {children}
    </JobContext.Provider>
  );
}

export function useJob() {
  const context = useContext(JobContext);
  if (!context) {
    throw new Error('useJob must be used within a JobProvider');
  }
  return context;
}
