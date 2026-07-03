import { useState } from 'react';
import { Sparkles, Wand2, Eraser, Image, Zap, Lock, Scan, LockOpen, ArchiveRestore } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useJob } from '@/contexts/JobContext';
import { cn } from '@/lib/utils';
import { PipelineSettings } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { EncryptModal } from './EncryptModal';
import { DecryptModal } from './DecryptModal';
import { ProcessConfirmDialog } from './ProcessConfirmDialog';

interface ActionButtonProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  recommended?: boolean;
  active?: boolean;
  variant?: 'default' | 'primary' | 'accent';
  compact?: boolean;
}

function ActionButton({ icon, title, description, onClick, disabled, recommended, active = false, variant = 'default', compact = false }: ActionButtonProps) {
  return (
    <Card
      className={cn(
        'relative cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg',
        disabled && 'opacity-50 cursor-not-allowed hover:scale-100 hover:shadow-none',
        variant === 'primary' && 'border-primary/50 bg-primary/5 hover:border-primary hover:bg-primary/10',
        variant === 'accent' && 'border-accent/50 bg-accent/5 hover:border-accent',
        active && 'ring-2 ring-primary/60 border-primary bg-primary/10 shadow-md',
        compact && 'min-w-[120px] shrink-0'
      )}
      title={compact ? description : undefined}
      onClick={() => !disabled && onClick()}
    >
      {recommended && (
        <Badge className={`absolute -top-2 -right-2 bg-primary text-primary-foreground ${compact ? "text-[10px]" : "text-xs"}`}>
          Recommended
        </Badge>
      )}
      <CardContent className={`${compact ? "p-2" : "p-4"} flex items-start ${compact ? "gap-2" : "gap-3"}`}>
        <div className={cn(
          `${compact ? "p-1.5" : "p-2.5"} rounded-lg shrink-0`,
          variant === 'primary' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
        )}>
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className={`${compact ? "text-[11px]" : "text-sm"} font-semibold`}>{title}</h3>
          {compact ? (
            <span className="sr-only">{description}</span>
          ) : (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{description}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface ActionButtonsProps {
  compact?: boolean;
}

export function ActionButtons({ compact = false }: ActionButtonsProps) {
  const { currentImage, settings, activePanel, updateEnhancement, updateOldPhoto, updateBackground, updateSecurity, setActivePanel, setPipelineConfigMode } = useWorkspace();
  const { startJob, isProcessing } = useJob();
  const { toast } = useToast();
  const [isEncryptModalOpen, setIsEncryptModalOpen] = useState(false);
  const [isDecryptModalOpen, setIsDecryptModalOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | {
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => void;
  }>(null);
  const showAdvanced = !compact;

  const hasImage = !!currentImage;
  const disabled = !hasImage || isProcessing;

  const runWithSettings = (customSettings: Partial<PipelineSettings>) => {
    if (!currentImage) return;
    
    const jobSettings: PipelineSettings = {
      enhancement: { ...settings.enhancement, ...customSettings.enhancement },
      oldPhoto: { ...settings.oldPhoto, ...(customSettings as Partial<PipelineSettings>).oldPhoto },
      background: { ...settings.background, ...customSettings.background },
      security: { ...settings.security, ...customSettings.security },
    };
    
    startJob(currentImage, jobSettings);
  };

  const handleAutoEnhance = () => {
    setPipelineConfigMode(false);
    setActivePanel('enhancement');
    setConfirmAction({
      title: 'Run Auto Enhance?',
      description: 'This will start enhancement immediately with the selected settings.',
      confirmLabel: 'Start Enhancement',
      onConfirm: () => {
        updateEnhancement({ enabled: true, mode: 'upscale4x', quality: 'high', restoreEnabled: true, restoreMode: 'auto', faceRestoration: true, denoiseStrength: 70, deblurStrength: 70 });
        updateBackground({ enabled: false });
        updateSecurity({ enabled: false });
        runWithSettings({
          enhancement: { enabled: true, mode: 'upscale4x', quality: 'high', restoreEnabled: true, restoreMode: 'auto', faceRestoration: true, denoiseStrength: 70, deblurStrength: 70 },
          background: { enabled: false, action: 'remove', type: 'transparent', edgeSmoothing: 50, refineEdges: true },
          security: { enabled: false },
        });
      },
    });
  };

  const handleCustomEnhance = () => {
    setPipelineConfigMode(false);
    setActivePanel('enhancement');
    updateEnhancement({ enabled: true, mode: 'upscale4x', quality: 'high', restoreEnabled: true, restoreMode: 'auto', faceRestoration: true, denoiseStrength: 70, deblurStrength: 70 });
    updateBackground({ enabled: false });
    updateSecurity({ enabled: false });
    // Just enable the controls, don't start - user will configure manually
  };

  const handleRemoveBlur = () => {
    setPipelineConfigMode(false);
    setActivePanel('restoration');
    updateOldPhoto({ enabled: true, mode: 'repair_only', restoreMode: 'deblur', repairBroken: false, colorize: false, faceRestoration: false, upscaleEnabled: false });
    updateBackground({ enabled: false });
    updateSecurity({ enabled: false });
    toast({
      title: 'Restoration controls opened',
      description: 'Use Old Photo AI settings and run dedicated restoration.',
    });
  };

  const handleRemoveBackground = () => {
    setPipelineConfigMode(false);
    setActivePanel('background');
    updateEnhancement({ enabled: false });
    updateBackground({ enabled: true, action: 'remove', type: 'transparent' });
    updateSecurity({ enabled: false });
    toast({
      title: 'Background controls opened',
      description: 'Adjust the background settings in the sidebar, then click Run Background.',
    });
  };

  const handleReplaceBackground = () => {
    setPipelineConfigMode(false);
    setActivePanel('background');
    updateEnhancement({ enabled: false });
    updateBackground({ enabled: true, action: 'replace', type: 'blur' });
    updateSecurity({ enabled: false });
    toast({
      title: 'Background controls opened',
      description: 'Set replacement options in the sidebar, then click Run Background.',
    });
  };

  const handleFullPipeline = () => {
    setPipelineConfigMode(false);
    setActivePanel('pipeline');
    setConfirmAction({
      title: 'Run Full AI Pipeline?',
      description: 'This will enhance the image and remove the background in one pass.',
      confirmLabel: 'Run Pipeline',
      onConfirm: () => {
        updateEnhancement({ enabled: true, mode: 'upscale4x', quality: 'high', restoreEnabled: true, restoreMode: 'auto', faceRestoration: true, denoiseStrength: 70, deblurStrength: 70 });
        updateBackground({ enabled: true, action: 'remove', type: 'transparent' });
        updateSecurity({ enabled: false });
        runWithSettings({
          enhancement: { enabled: true, mode: 'upscale4x', quality: 'high', restoreEnabled: true, restoreMode: 'auto', faceRestoration: true, denoiseStrength: 70, deblurStrength: 70 },
          background: { enabled: true, action: 'remove', type: 'transparent', edgeSmoothing: 50, refineEdges: true },
          security: { enabled: false },
        });
      },
    });
  };

  const handleEncrypt = () => {
    setPipelineConfigMode(false);
    setActivePanel('security');
    setIsEncryptModalOpen(true);
  };

  const handleDecrypt = () => {
    setPipelineConfigMode(false);
    setActivePanel('security');
    setIsDecryptModalOpen(true);
  };

  const handleAIRestoreOld = () => {
    setPipelineConfigMode(false);
    setActivePanel('restoration');
    const oldMode = settings.oldPhoto.mode || 'repair_only';
    updateOldPhoto({
      enabled: true,
      mode: oldMode,
      restoreMode: settings.oldPhoto.restoreMode || 'auto',
      colorize: settings.oldPhoto.colorize ?? false,
      repairBroken: settings.oldPhoto.repairBroken ?? false,
      autoMaskDamage: true,
      faceRestoration: settings.oldPhoto.faceRestoration ?? false,
      upscaleEnabled: settings.oldPhoto.upscaleEnabled ?? false,
      upscaleFactor: settings.oldPhoto.upscaleFactor ?? 2,
    });
    updateBackground({ enabled: false });
    updateSecurity({ enabled: false });
    toast({
      title: 'Restoration panel opened',
      description: 'Configure dedicated old image restoration settings, then run restoration.',
    });
  };

  const isAutoEnhanceActive = activePanel === 'enhancement' && settings.enhancement.enabled && settings.enhancement.mode === 'auto';
  const isCustomEnhanceActive = activePanel === 'enhancement' && settings.enhancement.enabled && settings.enhancement.mode !== 'auto';
  const isOldPhotoActive = activePanel === 'restoration' && settings.oldPhoto.enabled;
  const isRemoveBgActive = activePanel === 'background' && settings.background.enabled && settings.background.action === 'remove';
  const isReplaceBgActive = activePanel === 'background' && settings.background.enabled && settings.background.action === 'replace';
  const isFullPipelineActive = activePanel === 'pipeline';
  const isSecurityActive = activePanel === 'security';

  return (
    <Card className="border-dashed">
      <CardContent className={compact ? "p-2" : "p-4"}>
        {!compact && (
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground">
            {hasImage ? 'What do you want to do with this image?' : 'Upload an image to get started'}
          </h2>
        )}

        {compact ? (
          <div className="flex gap-2 overflow-x-auto pb-1 pr-1 scrollbar-thin">
            <ActionButton
              icon={<Sparkles className="h-4 w-4" />}
              title="Auto Enhance"
              description="AI-powered enhancement with optimal settings"
              onClick={handleAutoEnhance}
              disabled={disabled}
              active={isAutoEnhanceActive}
              recommended
              variant="primary"
              compact
            />
            <ActionButton
              icon={<ArchiveRestore className="h-4 w-4" />}
              title="Old Photo AI"
              description="Dedicated restoration for old/degraded images"
              onClick={handleAIRestoreOld}
              disabled={disabled}
              active={isOldPhotoActive}
              compact
              variant="accent"
            />
            <ActionButton
              icon={<Scan className="h-4 w-4" />}
              title="Remove Blur"
              description="Fix motion blur and restore edges"
              onClick={handleRemoveBlur}
              disabled={disabled}
              active={isOldPhotoActive}
              compact
            />
            <ActionButton
              icon={<Eraser className="h-4 w-4" />}
              title="Remove Background"
              description="Extract subject with transparent background"
              onClick={handleRemoveBackground}
              disabled={disabled}
              active={isRemoveBgActive}
              compact
            />
            <ActionButton
              icon={<Image className="h-4 w-4" />}
              title="Replace Background"
              description="Swap background with blur, color, or image"
              onClick={handleReplaceBackground}
              disabled={disabled}
              active={isReplaceBgActive}
              compact
            />
            <ActionButton
              icon={<Lock className="h-4 w-4" />}
              title="Encrypt Image"
              description="Secure with AES-256 encryption"
              onClick={handleEncrypt}
              disabled={disabled}
              active={isSecurityActive && isEncryptModalOpen}
              compact
            />
            <ActionButton
              icon={<LockOpen className="h-4 w-4" />}
              title="Decrypt Image"
              description="Restore encrypted .bin/.enc with password"
              onClick={handleDecrypt}
              disabled={!hasImage || isProcessing}
              active={isSecurityActive && isDecryptModalOpen}
              compact
            />
          </div>
        ) : (
          <div className={`${compact ? "gap-2" : "gap-2.5"} grid ${compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
          <ActionButton
            icon={<Sparkles className={compact ? "h-4 w-4" : "h-5 w-5"} />}
            title="Auto Enhance"
            description="AI-powered enhancement with optimal settings"
            onClick={handleAutoEnhance}
            disabled={disabled}
            active={isAutoEnhanceActive}
            recommended
            variant="primary"
            compact={compact}
          />
          {showAdvanced && (
            <ActionButton
              icon={<Wand2 className={compact ? "h-4 w-4" : "h-5 w-5"} />}
              title="Custom Enhance"
              description="Choose upscaling, denoising, deblurring options"
              onClick={handleCustomEnhance}
              disabled={disabled}
              active={isCustomEnhanceActive}
              compact={compact}
            />
          )}

          <ActionButton
            icon={<ArchiveRestore className={compact ? "h-4 w-4" : "h-5 w-5"} />}
            title="Old Photo AI Restoration"
            description="Dedicated heavy restoration flow for old/degraded images"
            onClick={handleAIRestoreOld}
            disabled={disabled}
            active={isOldPhotoActive}
            variant="accent"
            compact={compact}
          />

          <ActionButton
            icon={<Scan className={compact ? "h-4 w-4" : "h-5 w-5"} />}
            title="Remove Blur"
            description="Fix motion blur and restore edges"
            onClick={handleRemoveBlur}
            disabled={disabled}
            active={isOldPhotoActive}
            compact={compact}
          />
          
          <ActionButton
            icon={<Eraser className={compact ? "h-4 w-4" : "h-5 w-5"} />}
            title="Remove Background"
            description="Extract subject with transparent background"
            onClick={handleRemoveBackground}
            disabled={disabled}
            active={isRemoveBgActive}
            compact={compact}
          />
          
          <ActionButton
            icon={<Image className={compact ? "h-4 w-4" : "h-5 w-5"} />}
            title="Replace Background"
            description="Swap background with blur, color, or image"
            onClick={handleReplaceBackground}
            disabled={disabled}
            active={isReplaceBgActive}
            compact={compact}
          />
          {showAdvanced && (
            <ActionButton
              icon={<Zap className={compact ? "h-4 w-4" : "h-5 w-5"} />}
              title="Run Full AI Pipeline"
              description="Enhance + remove background in one go"
              onClick={handleFullPipeline}
              disabled={disabled}
              active={isFullPipelineActive}
              variant="accent"
              compact={compact}
            />
          )}
          
          <ActionButton
            icon={<Lock className={compact ? "h-4 w-4" : "h-5 w-5"} />}
            title="Encrypt Image"
            description="Secure with AES-256 encryption"
            onClick={handleEncrypt}
            disabled={disabled}
            active={isSecurityActive && isEncryptModalOpen}
            compact={compact}
          />

          <ActionButton
            icon={<LockOpen className={compact ? "h-4 w-4" : "h-5 w-5"} />}
            title="Decrypt Image"
            description="Restore encrypted .bin/.enc with password"
            onClick={handleDecrypt}
            disabled={disabled}
            active={isSecurityActive && isDecryptModalOpen}
            compact={compact}
          />
        </div>
        )}
      </CardContent>

      <ProcessConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title || ''}
        description={confirmAction?.description || ''}
        confirmLabel={confirmAction?.confirmLabel || 'Continue'}
        loading={isProcessing}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        onConfirm={() => {
          confirmAction?.onConfirm();
          setConfirmAction(null);
        }}
      />

      <EncryptModal
        isOpen={isEncryptModalOpen}
        onClose={() => setIsEncryptModalOpen(false)}
      />
      <DecryptModal
        isOpen={isDecryptModalOpen}
        onClose={() => setIsDecryptModalOpen(false)}
      />
    </Card>
  );
}
