import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import {
  ImageFile,
  ImageVersion,
  PipelineSettings,
  EnhancementMode,
  QualityLevel,
  BackgroundAction,
  BackgroundType,
  ExportFormat,
  ExpiryDuration,
  PipelinePreset,
} from '@/types';

export type WorkspacePanel = 'pipeline' | 'enhancement' | 'background' | 'security' | 'restoration';

const MAX_OPEN_IMAGES = 5;

interface WorkspaceContextType {
  // Multi-image state
  openImages: ImageFile[];
  activeImageId: string | null;
  addImage: (image: ImageFile) => boolean;
  removeImage: (imageId: string) => void;
  setActiveImage: (imageId: string) => void;

  // Legacy single-image getters (backward compatible)
  currentImage: ImageFile | null;
  setCurrentImage: (image: ImageFile | null) => void;
  imageHistory: ImageVersion[];
  selectedVersionId: string | null;
  selectImageVersion: (versionId: string) => void;
  addProcessedVersion: (url: string, options?: { name?: string; sourceJobId?: string; operation?: 'enhanced' | 'background-replaced' }) => void;

  // Pipeline settings
  settings: PipelineSettings;
  updateEnhancement: (updates: Partial<PipelineSettings['enhancement']>) => void;
  updateOldPhoto: (updates: Partial<PipelineSettings['oldPhoto']>) => void;
  updateBackground: (updates: Partial<PipelineSettings['background']>) => void;
  updateSecurity: (updates: Partial<PipelineSettings['security']>) => void;
  resetSettings: () => void;

  // Export settings
  exportFormat: ExportFormat;
  setExportFormat: (format: ExportFormat) => void;
  shareLinkExpiry: ExpiryDuration;
  setShareLinkExpiry: (expiry: ExpiryDuration) => void;

  // Presets
  activePreset: PipelinePreset | null;
  applyPreset: (preset: PipelinePreset) => void;
  // Active workspace panel
  activePanel: WorkspacePanel;
  setActivePanel: (panel: WorkspacePanel) => void;
  pipelineConfigMode: boolean;
  setPipelineConfigMode: (enabled: boolean) => void;

  // View state
  showComparison: boolean;
  setShowComparison: (show: boolean) => void;
  comparisonPosition: number;
  setComparisonPosition: (position: number) => void;
  zoomLevel: number;
  setZoomLevel: (level: number) => void;

  // Decrypt preview state
  decryptedPreviewUrl: string | null;
  decryptedPreviewName: string | null;
  setDecryptedPreview: (previewUrl: string, fileName?: string) => void;
  clearDecryptedPreview: () => void;

  // Callback for JobContext integration
  onImageRemovedRef: React.MutableRefObject<((imageId: string) => void) | null>;
}

const defaultSettings: PipelineSettings = {
  enhancement: {
    enabled: true,
    mode: 'auto',
    restoreEnabled: true,
    restoreMode: 'auto',
    quality: 'high',
    faceRestoration: true,
    denoiseStrength: 70,
    deblurStrength: 70,
  },
  oldPhoto: {
    enabled: false,
    mode: 'repair_only',
    colorize: false,
    repairBroken: false,
    autoMaskDamage: true,
    restoreMode: 'auto',
    faceRestoration: false,
    faceStrength: 60,
    denoiseStrength: 35,
    deblurStrength: 50,
    upscaleEnabled: false,
    upscaleFactor: 2,
  },
  background: {
    enabled: false,
    action: 'remove',
    type: 'transparent',
    edgeSmoothing: 50,
    refineEdges: true,
  },
  security: {
    enabled: false,
  },
};

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export const pipelinePresets: PipelinePreset[] = [
  {
    id: 'default',
    name: 'Default Balanced Pipeline',
    description: 'Best for most images - balanced quality and speed',
    settings: {
      enhancement: { enabled: true, mode: 'auto', restoreEnabled: true, restoreMode: 'auto', quality: 'high', faceRestoration: true, denoiseStrength: 70, deblurStrength: 70 },
      oldPhoto: { enabled: false, mode: 'repair_only', colorize: false, repairBroken: false, autoMaskDamage: true, restoreMode: 'auto', faceRestoration: false, faceStrength: 60, denoiseStrength: 35, deblurStrength: 50, upscaleEnabled: false, upscaleFactor: 2 },
      background: { enabled: false, action: 'remove', type: 'transparent', edgeSmoothing: 50, refineEdges: true },
      security: { enabled: false },
    },
  },
  {
    id: 'quick',
    name: 'Quick Process',
    description: 'Fast processing for previews',
    settings: {
      enhancement: { enabled: true, mode: 'auto', restoreEnabled: false, restoreMode: 'auto', quality: 'fast' },
      oldPhoto: { enabled: false, mode: 'repair_only', colorize: false, repairBroken: false, autoMaskDamage: true, restoreMode: 'auto', faceRestoration: false, faceStrength: 60, denoiseStrength: 35, deblurStrength: 50, upscaleEnabled: false, upscaleFactor: 2 },
      background: { enabled: false, action: 'remove', type: 'transparent', edgeSmoothing: 50, refineEdges: true },
      security: { enabled: false },
    },
  },
  {
    id: 'maximum',
    name: 'Maximum Quality',
    description: 'Best quality with all enhancements',
    settings: {
      enhancement: { enabled: true, mode: 'auto', restoreEnabled: true, restoreMode: 'deblur', quality: 'high' },
      oldPhoto: { enabled: true, mode: 'repair_face', colorize: false, repairBroken: false, autoMaskDamage: true, restoreMode: 'auto', faceRestoration: true, faceStrength: 70, denoiseStrength: 35, deblurStrength: 60, upscaleEnabled: false, upscaleFactor: 2 },
      background: { enabled: true, action: 'remove', type: 'transparent', edgeSmoothing: 50, refineEdges: true },
      security: { enabled: false },
    },
  },
  {
    id: 'secure-share',
    name: 'Secure Share',
    description: 'Enhanced with encryption for secure sharing',
    settings: {
      enhancement: { enabled: true, mode: 'auto', restoreEnabled: true, restoreMode: 'auto', quality: 'high', faceRestoration: true, denoiseStrength: 70, deblurStrength: 70 },
      oldPhoto: { enabled: false, mode: 'repair_only', colorize: false, repairBroken: false, autoMaskDamage: true, restoreMode: 'auto', faceRestoration: false, faceStrength: 60, denoiseStrength: 35, deblurStrength: 50, upscaleEnabled: false, upscaleFactor: 2 },
      background: { enabled: false, action: 'remove', type: 'transparent', edgeSmoothing: 50, refineEdges: true },
      security: { enabled: true },
    },
  },
];

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  // Multi-image state
  const [openImages, setOpenImages] = useState<ImageFile[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [imageHistoryMap, setImageHistoryMap] = useState<Record<string, ImageVersion[]>>({});
  const [selectedVersionIdMap, setSelectedVersionIdMap] = useState<Record<string, string | null>>({});

  const [settings, setSettings] = useState<PipelineSettings>(defaultSettings);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [shareLinkExpiry, setShareLinkExpiry] = useState<ExpiryDuration>('24h');
  const [activePreset, setActivePreset] = useState<PipelinePreset | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonPosition, setComparisonPosition] = useState(50);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [activePanel, setActivePanel] = useState<WorkspacePanel>('pipeline');
  const [pipelineConfigMode, setPipelineConfigMode] = useState(false);
  const [decryptedPreviewUrl, setDecryptedPreviewUrl] = useState<string | null>(null);
  const [decryptedPreviewName, setDecryptedPreviewName] = useState<string | null>(null);

  // Callback ref for JobContext to register its cleanup handler
  const onImageRemovedRef = useRef<((imageId: string) => void) | null>(null);

  // Computed: current image from active tab
  const currentImage = activeImageId
    ? openImages.find((img) => img.id === activeImageId) ?? null
    : null;

  // Computed: image history for active tab
  const imageHistory = activeImageId ? imageHistoryMap[activeImageId] ?? [] : [];
  const selectedVersionId = activeImageId ? selectedVersionIdMap[activeImageId] ?? null : null;

  const clearDecryptedPreview = useCallback(() => {
    setDecryptedPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setDecryptedPreviewName(null);
  }, []);

  // Add a new image (up to MAX_OPEN_IMAGES)
  const addImage = useCallback((image: ImageFile): boolean => {
    let added = false;
    setOpenImages((prev) => {
      if (prev.length >= MAX_OPEN_IMAGES) return prev;
      // Prevent duplicate
      if (prev.some((img) => img.id === image.id)) {
        setActiveImageId(image.id);
        return prev;
      }
      added = true;
      return [...prev, image];
    });

    if (!added) return false;

    // Create initial history for this image
    const versionId = `v-${Date.now()}`;
    setImageHistoryMap((prev) => ({
      ...prev,
      [image.id]: [
        {
          id: versionId,
          name: image.name,
          url: image.url,
          createdAt: new Date(),
          source: 'upload',
          operation: 'original',
        },
      ],
    }));
    setSelectedVersionIdMap((prev) => ({ ...prev, [image.id]: versionId }));
    setActiveImageId(image.id);
    clearDecryptedPreview();
    return true;
  }, [clearDecryptedPreview]);

  // Remove an image and clean up
  const removeImage = useCallback((imageId: string) => {
    // Notify JobContext to cancel any associated job
    onImageRemovedRef.current?.(imageId);

    setOpenImages((prev) => {
      const idx = prev.findIndex((img) => img.id === imageId);
      if (idx === -1) return prev;

      // Revoke URL
      URL.revokeObjectURL(prev[idx].url);

      const next = prev.filter((img) => img.id !== imageId);

      // Switch active to neighbor
      setActiveImageId((currentActive) => {
        if (currentActive !== imageId) return currentActive;
        if (next.length === 0) return null;
        // Prefer the tab to the left, then right
        const newIdx = Math.min(idx, next.length - 1);
        return next[newIdx].id;
      });

      return next;
    });

    // Clean up history for removed image
    setImageHistoryMap((prev) => {
      const next = { ...prev };
      // Revoke any blob URLs in history
      const history = next[imageId];
      if (history) {
        history.forEach((v) => {
          if (v.url && v.url.startsWith('blob:') && v.source !== 'upload') {
            URL.revokeObjectURL(v.url);
          }
        });
      }
      delete next[imageId];
      return next;
    });
    setSelectedVersionIdMap((prev) => {
      const next = { ...prev };
      delete next[imageId];
      return next;
    });
    clearDecryptedPreview();
  }, [clearDecryptedPreview]);

  // Switch active tab
  const setActiveImage = useCallback((imageId: string) => {
    setActiveImageId(imageId);
    clearDecryptedPreview();
  }, [clearDecryptedPreview]);

  // Legacy setCurrentImage - backward compat for single-image add/clear
  const setCurrentImage = useCallback((image: ImageFile | null) => {
    if (!image) {
      // Close the active image
      if (activeImageId) {
        removeImage(activeImageId);
      }
      return;
    }
    addImage(image);
  }, [activeImageId, addImage, removeImage]);

  const selectImageVersion = useCallback((versionId: string) => {
    if (!activeImageId) return;
    const history = imageHistoryMap[activeImageId] ?? [];
    const target = history.find((v) => v.id === versionId);
    if (!target) return;

    setSelectedVersionIdMap((prev) => ({ ...prev, [activeImageId]: versionId }));

    // Update the image in openImages to reflect the selected version
    setOpenImages((prev) =>
      prev.map((img) =>
        img.id === activeImageId
          ? { ...img, name: target.name, url: target.url, file: undefined }
          : img,
      ),
    );
  }, [activeImageId, imageHistoryMap]);

  const addProcessedVersion = useCallback((url: string, options?: { name?: string; sourceJobId?: string; operation?: 'enhanced' | 'background-replaced' }) => {
    if (!activeImageId) return;

    const versionId = `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const name = options?.name || 'processed-image.png';

    setImageHistoryMap((prev) => {
      const history = prev[activeImageId] ?? [];
      if (history.some((v) => v.url === url)) {
        const existing = history.find((v) => v.url === url);
        if (existing) {
          setSelectedVersionIdMap((p) => ({ ...p, [activeImageId]: existing.id }));
          setOpenImages((imgs) =>
            imgs.map((img) =>
              img.id === activeImageId
                ? { ...img, url: existing.url, name: existing.name, file: undefined }
                : img,
            ),
          );
        }
        return prev;
      }

      const next: ImageVersion = {
        id: versionId,
        name,
        url,
        createdAt: new Date(),
        source: 'processed',
        sourceJobId: options?.sourceJobId,
        operation: options?.operation || 'enhanced',
      };

      setSelectedVersionIdMap((p) => ({ ...p, [activeImageId]: versionId }));
      setOpenImages((imgs) =>
        imgs.map((img) =>
          img.id === activeImageId
            ? { ...img, name, url, file: undefined }
            : img,
        ),
      );

      return { ...prev, [activeImageId]: [...history, next] };
    });
  }, [activeImageId]);

  const setDecryptedPreview = useCallback((previewUrl: string, fileName?: string) => {
    setDecryptedPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return previewUrl;
    });
    setDecryptedPreviewName(fileName || null);
  }, []);

  const updateEnhancement = useCallback((updates: Partial<PipelineSettings['enhancement']>) => {
    setSettings(prev => ({
      ...prev,
      enhancement: { ...prev.enhancement, ...updates },
    }));
    if (!pipelineConfigMode) {
      setActivePreset(null);
    }
  }, [pipelineConfigMode]);

  const updateOldPhoto = useCallback((updates: Partial<PipelineSettings['oldPhoto']>) => {
    setSettings(prev => ({
      ...prev,
      oldPhoto: { ...prev.oldPhoto, ...updates },
    }));
    if (!pipelineConfigMode) {
      setActivePreset(null);
    }
  }, [pipelineConfigMode]);

  const updateBackground = useCallback((updates: Partial<PipelineSettings['background']>) => {
    setSettings(prev => ({
      ...prev,
      background: { ...prev.background, ...updates },
    }));
    if (!pipelineConfigMode) {
      setActivePreset(null);
    }
  }, [pipelineConfigMode]);

  const updateSecurity = useCallback((updates: Partial<PipelineSettings['security']>) => {
    setSettings(prev => ({
      ...prev,
      security: { ...prev.security, ...updates },
    }));
    if (!pipelineConfigMode) {
      setActivePreset(null);
    }
  }, [pipelineConfigMode]);

  const resetSettings = useCallback(() => {
    setSettings(defaultSettings);
    setActivePreset(null);
  }, []);

  const applyPreset = useCallback((preset: PipelinePreset) => {
    setSettings(prev => ({
      ...prev,
      ...preset.settings,
      enhancement: { ...prev.enhancement, ...preset.settings.enhancement },
      background: { ...prev.background, ...preset.settings.background },
      security: { ...prev.security, ...preset.settings.security },
    }));
    setActivePreset(preset);
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        openImages,
        activeImageId,
        addImage,
        removeImage,
        setActiveImage,
        currentImage,
        setCurrentImage,
        imageHistory,
        selectedVersionId,
        selectImageVersion,
        addProcessedVersion,
        settings,
        updateEnhancement,
        updateOldPhoto,
        updateBackground,
        updateSecurity,
        resetSettings,
        exportFormat,
        setExportFormat,
        shareLinkExpiry,
        setShareLinkExpiry,
        activePreset,
        applyPreset,
        activePanel,
        setActivePanel,
        pipelineConfigMode,
        setPipelineConfigMode,
        showComparison,
        setShowComparison,
        comparisonPosition,
        setComparisonPosition,
        zoomLevel,
        setZoomLevel,
        decryptedPreviewUrl,
        decryptedPreviewName,
        setDecryptedPreview,
        clearDecryptedPreview,
        onImageRemovedRef,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
