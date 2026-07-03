// User & Auth Types
export type UserRole = 'guest' | 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  createdAt: Date;
  status: 'active' | 'disabled';
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Job & Processing Types
export type JobStatus = 'pending' | 'uploading' | 'enhancing' | 'segmenting' | 'replacing' | 'encrypting' | 'completed' | 'failed' | 'cancelled';

export type EnhancementMode = 'auto' | 'upscale2x' | 'upscale4x' | 'denoise' | 'deblur';
export type RestoreMode = 'deblur' | 'denoise' | 'auto';
export type OldPhotoMode = 'repair_only' | 'repair_face' | 'repair_upscale' | 'repair_colorize';
export type QualityLevel = 'fast' | 'balanced' | 'high';
export type BackgroundAction = 'remove' | 'replace';
export type BackgroundType = 'transparent' | 'solid' | 'blur' | 'preset' | 'custom';
export type ExportFormat = 'png' | 'jpg' | 'webp';
export type ExpiryDuration = '1h' | '24h' | '7d';

export interface PipelineStep {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'skipped' | 'failed';
  progress: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface PipelineSettings {
  enhancement: {
    enabled: boolean;
    mode: EnhancementMode;
    restoreEnabled?: boolean;
    restoreMode?: RestoreMode;
    quality: QualityLevel;
    faceRestoration?: boolean;
    denoiseStrength?: number;
    deblurStrength?: number;
  };
  oldPhoto: {
    enabled: boolean;
    mode: OldPhotoMode;
    colorize: boolean;
    repairBroken: boolean;
    autoMaskDamage: boolean;
    restoreMode: RestoreMode;
    faceRestoration: boolean;
    faceStrength: number;
    denoiseStrength: number;
    deblurStrength: number;
    upscaleEnabled: boolean;
    upscaleFactor: 2 | 4;
  };
  background: {
    enabled: boolean;
    action: BackgroundAction;
    type: BackgroundType;
    color?: string;
    blurAmount?: number;
    presetId?: string;
    customImageUrl?: string;
    edgeSmoothing: number;
    refineEdges: boolean;
  };
  security: {
    enabled: boolean;
    password?: string;
  };
}

export interface JobMetrics {
  psnr?: number; // Peak Signal-to-Noise Ratio
  ssim?: number; // Structural Similarity Index
  dice?: number; // Dice coefficient for segmentation
  encryptionSuccess?: boolean;
}

export interface JobDebugInfo {
  input_size?: {
    bytes?: number;
    width?: number;
    height?: number;
  };
  output_size?: {
    bytes?: number;
    width?: number;
    height?: number;
  };
  mean_pixel_delta?: number;
  mask_coverage?: number;
  stage_debug_dir?: string;
  stage_diagnostics?: Record<string, {
    mean_delta?: number;
    ssim_vs_prev?: number;
    destructive?: boolean;
    duration_seconds?: number;
  }>;
  face_detected?: boolean;
}

export interface Job {
  id: string;
  userId?: string;
  status: JobStatus;
  steps: PipelineStep[];
  currentStepIndex: number;
  progress: number;
  settings: PipelineSettings;
  originalImage: ImageFile;
  enhancedImageUrl?: string;
  backgroundEditedUrl?: string;
  encryptedPackageUrl?: string;
  metrics?: JobMetrics;
  oldPhotoMode?: OldPhotoMode;
  warnings?: string[];
  usedFallback?: boolean;
  stagesCompleted?: string[];
  modelsUsed?: string[];
  modelFailures?: string[];
  outputChanged?: boolean | null;
  noMeaningfulChange?: boolean;
  stageTimings?: Record<string, number>;
  lastHeartbeat?: string;
  stepStartedAt?: string;
  maskCoverage?: number | null;
  maskCoverageTotal?: number | null;
  maskCoverageCentral?: number | null;
  destructiveStageDetected?: boolean;
  destructiveOutputPrevented?: boolean;
  destructiveStagePrevented?: boolean;
  usedSafeFallback?: boolean;
  usedDeblur?: boolean;
  usedDenoiseFallback?: boolean;
  usedInpainting?: boolean;
  usedEnhancement?: boolean;
  usedFaceRecovery?: boolean;
  finalStageSelected?: string;
  modelAvailability?: Record<string, boolean>;
  stagesRun?: string[];
  stagesSkipped?: string[];
  stagesRejected?: string[];
  debug?: JobDebugInfo;
  iterations?: number;
  promptDismissed?: boolean;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  expiresAt?: Date;
  shareLink?: string;
  shareLinkExpiry?: Date;
}

export interface ImageFile {
  id: string;
  name: string;
  url: string;
  file?: File;
  size: number;
  width: number;
  height: number;
  format: string;
}

export interface ImageVersion {
  id: string;
  name: string;
  url: string;
  createdAt: Date;
  sourceJobId?: string;
  source: 'upload' | 'processed' | 'decrypted';
  operation?: 'original' | 'enhanced' | 'background-replaced' | 'decrypted';
}

// Vault Types
export interface VaultItem {
  id: string;
  job: Job;
  thumbnail: string;
  operations: ('enhancement' | 'background' | 'encryption')[];
  createdAt: Date;
  expiresAt: Date;
}

// Admin Types
export type ModelStatus = 'online' | 'offline' | 'degraded';

export interface ModelInfo {
  id: string;
  name: string;
  type: 'enhancement' | 'segmentation' | 'security';
  status: ModelStatus;
  uptime: number;
  lastHeartbeat: Date;
  version: string;
}

export interface SystemMetrics {
  queueLength: number;
  avgProcessingTime: number;
  errorRate: number;
  totalJobsToday: number;
  activeUsers: number;
}

export type AuditAction = 'login' | 'logout' | 'upload' | 'run' | 'download' | 'share' | 'delete' | 'role_change' | 'user_disable';

export interface AuditLog {
  id: string;
  timestamp: Date;
  actorId: string;
  actorEmail?: string;
  actorRole: UserRole;
  action: AuditAction;
  jobId?: string;
  details?: string;
  ipAddress: string;
}

// Preset Types
export interface PipelinePreset {
  id: string;
  name: string;
  description: string;
  settings: Partial<PipelineSettings>;
}

export interface BackgroundPreset {
  id: string;
  name: string;
  thumbnailUrl: string;
  fullUrl: string;
  category: string;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
