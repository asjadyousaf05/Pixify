import { useMemo, useState } from 'react';
import { ShieldCheck, Sparkles, ScanFace, Palette, ImageOff, PencilRuler, Scaling, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useJob } from '@/contexts/JobContext';
import { useToast } from '@/hooks/use-toast';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { OldPhotoMode, RestoreMode } from '@/types';
import { ProcessConfirmDialog } from './ProcessConfirmDialog';

const OLD_PHOTO_MODES: Array<{ value: OldPhotoMode; title: string; description: string }> = [
  { value: 'repair_only', title: 'Repair Only', description: 'Conservative structural restoration only.' },
  { value: 'repair_face', title: 'Repair + Face', description: 'Restoration with optional face recovery.' },
  { value: 'repair_upscale', title: 'Repair + Upscale', description: 'Restoration followed by careful upscaling.' },
  { value: 'repair_colorize', title: 'Repair + Colorize', description: 'Restoration followed by optional colorization.' },
];

function modePreset(mode: OldPhotoMode) {
  switch (mode) {
    case 'repair_face':
      return { faceRestoration: true, upscaleEnabled: false, colorize: false };
    case 'repair_upscale':
      return { faceRestoration: false, upscaleEnabled: true, colorize: false };
    case 'repair_colorize':
      return { faceRestoration: false, upscaleEnabled: false, colorize: true };
    default:
      return { faceRestoration: false, upscaleEnabled: false, colorize: false };
  }
}

export function RestorationControls() {
  const { currentImage, settings, updateOldPhoto, updateBackground, updateSecurity } = useWorkspace();
  const { startOldPhotoRestoration, isProcessing } = useJob();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const activeMode = settings.oldPhoto.mode || 'repair_only';
  const selectedMode = useMemo(
    () => OLD_PHOTO_MODES.find((m) => m.value === activeMode) || OLD_PHOTO_MODES[0],
    [activeMode],
  );

  const applyMode = (mode: OldPhotoMode) => {
    const preset = modePreset(mode);
    updateOldPhoto({
      mode,
      enabled: true,
      faceRestoration: preset.faceRestoration,
      upscaleEnabled: preset.upscaleEnabled,
      colorize: preset.colorize,
      repairBroken: settings.oldPhoto.repairBroken,
      autoMaskDamage: settings.oldPhoto.autoMaskDamage,
      restoreMode: settings.oldPhoto.restoreMode || 'auto',
    });
  };

  const handleRunRestoration = () => {
    if (!currentImage) {
      toast({
        title: 'No image selected',
        description: 'Please upload an old or degraded image first.',
        variant: 'destructive',
      });
      return;
    }
    setConfirmOpen(true);
  };

  const confirmRunRestoration = () => {
    if (!currentImage) return;

    const restorationSettings = {
      ...settings,
      oldPhoto: {
        ...settings.oldPhoto,
        enabled: true,
      },
      background: { ...settings.background, enabled: false },
      security: { ...settings.security, enabled: false },
    };

    updateOldPhoto({ enabled: true });
    updateBackground({ enabled: false });
    updateSecurity({ enabled: false });

    startOldPhotoRestoration(currentImage, restorationSettings);
    toast({
      title: 'Old photo restoration started',
      description: `${selectedMode.title} mode is running with conservative safety gates.`,
    });

    setConfirmOpen(false);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border bg-muted/20 p-3">
        <p className="text-sm font-medium flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Dedicated Old Photo AI (Conservative)
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          This path is restoration-first and identity-safe: preprocess, primary restoration, optional face/upscale/colorize, then best-stage selection.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Old Photo Intent</Label>
        <RadioGroup
          value={activeMode}
          onValueChange={(value) => applyMode(value as OldPhotoMode)}
          className="grid grid-cols-1 gap-2"
        >
          {OLD_PHOTO_MODES.map((mode) => (
            <Label key={mode.value} className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
              <RadioGroupItem value={mode.value} />
              <span className="space-y-0.5">
                <span className="block font-medium text-foreground">{mode.title}</span>
                <span className="block text-muted-foreground">{mode.description}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </div>

      <div className="rounded-md border bg-background/60 p-2.5 text-xs text-muted-foreground space-y-1">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Wrench className="h-3.5 w-3.5" />
          Active Mode: {selectedMode.title}
        </div>
        <div>Face stage: {settings.oldPhoto.faceRestoration ? 'enabled' : 'disabled'}</div>
        <div>Upscale stage: {settings.oldPhoto.upscaleEnabled ? `${settings.oldPhoto.upscaleFactor}x` : 'disabled'}</div>
        <div>Colorize stage: {settings.oldPhoto.colorize ? 'enabled' : 'disabled'}</div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Primary Restoration Model Preference</Label>
        <RadioGroup
          value={settings.oldPhoto.restoreMode || 'auto'}
          onValueChange={(value) => updateOldPhoto({ restoreMode: value as RestoreMode, enabled: true })}
          className="grid grid-cols-3 gap-2"
        >
          {['auto', 'deblur', 'denoise'].map((mode) => (
            <Label key={mode} className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
              <RadioGroupItem value={mode} />
              {mode}
            </Label>
          ))}
        </RadioGroup>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Deblur Strength (Primary Model Blend)</Label>
          <span className="text-xs text-muted-foreground">{settings.oldPhoto.deblurStrength}%</span>
        </div>
        <Slider
          value={[settings.oldPhoto.deblurStrength]}
          onValueChange={([v]) => updateOldPhoto({ deblurStrength: v, enabled: true })}
          max={100}
          step={1}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Denoise Fallback Strength</Label>
          <span className="text-xs text-muted-foreground">{settings.oldPhoto.denoiseStrength}%</span>
        </div>
        <Slider
          value={[settings.oldPhoto.denoiseStrength]}
          onValueChange={([v]) => updateOldPhoto({ denoiseStrength: v, enabled: true })}
          max={100}
          step={1}
        />
      </div>

      <div className="space-y-3 rounded-md border bg-background/60 p-2.5">
        <Label className="text-xs font-medium text-foreground">Safety Overrides (Advanced)</Label>

        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <ImageOff className="h-3 w-3" /> Allow small-area inpainting
          </Label>
          <Switch
            checked={settings.oldPhoto.repairBroken}
            onCheckedChange={(checked) => updateOldPhoto({ repairBroken: checked, enabled: true })}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <PencilRuler className="h-3 w-3" /> Auto damage mask
          </Label>
          <Switch
            checked={settings.oldPhoto.autoMaskDamage}
            onCheckedChange={(checked) => updateOldPhoto({ autoMaskDamage: checked, enabled: true })}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <ScanFace className="h-3 w-3" /> Face recovery
          </Label>
          <Switch
            checked={settings.oldPhoto.faceRestoration}
            onCheckedChange={(checked) => updateOldPhoto({ faceRestoration: checked, enabled: true })}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Face Strength</Label>
            <span className="text-xs text-muted-foreground">{settings.oldPhoto.faceStrength}%</span>
          </div>
          <Slider
            value={[settings.oldPhoto.faceStrength]}
            onValueChange={([v]) => updateOldPhoto({ faceStrength: v, enabled: true })}
            max={100}
            step={1}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <Scaling className="h-3 w-3" /> Upscale stage enabled
          </Label>
          <Switch
            checked={settings.oldPhoto.upscaleEnabled}
            onCheckedChange={(checked) => updateOldPhoto({ upscaleEnabled: checked, enabled: true })}
          />
        </div>

        <RadioGroup
          value={String(settings.oldPhoto.upscaleFactor)}
          onValueChange={(value) => updateOldPhoto({ upscaleFactor: value === '4' ? 4 : 2, enabled: true })}
          className="grid grid-cols-2 gap-2"
        >
          <Label className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
            <RadioGroupItem value="2" />
            2x Upscale
          </Label>
          <Label className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
            <RadioGroupItem value="4" />
            4x Upscale
          </Label>
        </RadioGroup>

        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <Palette className="h-3 w-3" /> Colorize stage enabled
          </Label>
          <Switch
            checked={settings.oldPhoto.colorize}
            onCheckedChange={(checked) => updateOldPhoto({ colorize: checked, enabled: true })}
          />
        </div>
      </div>

      <Button className="w-full" onClick={handleRunRestoration} disabled={!currentImage || isProcessing}>
        <Sparkles className="mr-2 h-4 w-4" />
        Run Old Photo AI ({selectedMode.title})
      </Button>

      <ProcessConfirmDialog
        open={confirmOpen}
        title="Run Old Photo AI restoration?"
        description="This runs the dedicated quality-safe old-photo pipeline with stage-by-stage quality gates."
        confirmLabel="Start Restoration"
        loading={isProcessing}
        onOpenChange={setConfirmOpen}
        onConfirm={confirmRunRestoration}
      />
    </div>
  );
}

