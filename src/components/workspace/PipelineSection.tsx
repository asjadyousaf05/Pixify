import { useState } from 'react';
import { Sparkles, User, Package, Building2, ChevronRight, Check, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkspace, pipelinePresets } from '@/contexts/WorkspaceContext';
import { useJob } from '@/contexts/JobContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ProcessConfirmDialog } from './ProcessConfirmDialog';

export function PipelineSection() {
  const {
    currentImage,
    settings,
    activePreset,
    applyPreset,
    setActivePanel,
    setPipelineConfigMode,
  } = useWorkspace();
  const { startJob, isProcessing } = useJob();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [useCompactWorkflowPicker, setUseCompactWorkflowPicker] = useState(false);

  const handleRunPipeline = () => {
    if (!currentImage) {
      toast({
        title: 'No image selected',
        description: 'Please upload an image first.',
        variant: 'destructive',
      });
      return;
    }

    setConfirmOpen(true);
  };

  const confirmRunPipeline = () => {
    if (!currentImage) return;

    startJob(currentImage, settings);
    toast({
      title: 'Processing started',
      description: 'Your image is being processed.',
    });
    setConfirmOpen(false);
  };

  const workflowIcons: Record<string, typeof Sparkles> = {
    default: Sparkles,
    quick: Package,
    maximum: Building2,
    'secure-share': User,
  };

  const workflows = pipelinePresets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    desc: preset.description,
    icon: workflowIcons[preset.id] || Sparkles,
  }));
  const selectedWorkflow = workflows.find((wf) => wf.id === activePreset?.id);
  const SelectedWorkflowIcon = selectedWorkflow?.icon;
  const selectedSteps = [
    settings.enhancement.enabled
      ? {
          id: 'enhancement',
          title: 'Enhancement',
          description: 'Tune quality, denoise, deblur, and face restoration.',
          actionLabel: 'Configure',
          onClick: () => {
            setPipelineConfigMode(true);
            setActivePanel('enhancement');
          },
        }
      : null,
    settings.background.enabled
      ? {
          id: 'background',
          title: 'Background',
          description: 'Set remove/replace behavior and edge refinement.',
          actionLabel: 'Configure',
          onClick: () => {
            setPipelineConfigMode(true);
            setActivePanel('background');
          },
        }
      : null,
    settings.security.enabled
      ? {
          id: 'security',
          title: 'Security',
          description: 'Manage password and encryption behavior.',
          actionLabel: 'Configure',
          onClick: () => {
            setPipelineConfigMode(true);
            setActivePanel('security');
          },
        }
      : null,
  ].filter(Boolean) as Array<{
    id: 'enhancement' | 'background' | 'security';
    title: string;
    description: string;
    actionLabel: string;
    onClick: () => void;
  }>;

  return (
    <div className="space-y-4">
      {/* Workflow Selection */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Select Workflow</Label>
        {useCompactWorkflowPicker ? (
          <Select
            value={activePreset?.id}
            onValueChange={(value) => {
              const preset = pipelinePresets.find((p) => p.id === value);
              if (preset) applyPreset(preset);
              setPipelineConfigMode(false);
            }}
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Choose workflow" />
            </SelectTrigger>
            <SelectContent>
              {workflows.map((wf) => (
                <SelectItem key={wf.id} value={wf.id}>{wf.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <RadioGroup
            value={activePreset?.id}
            onValueChange={(value) => {
              const preset = pipelinePresets.find((p) => p.id === value);
              if (preset) applyPreset(preset);
              setPipelineConfigMode(false);
              setUseCompactWorkflowPicker(true);
            }}
            className="grid grid-cols-1 gap-2"
          >
            {workflows.map((wf) => {
              const isSelected = activePreset?.id === wf.id;
              const PresetIcon = wf.icon;
              return (
                <div key={wf.id}>
                  <RadioGroupItem value={wf.id} id={wf.id} className="peer sr-only" />
                  <Label
                    htmlFor={wf.id}
                    className={cn(
                      'flex items-center p-3 rounded-lg border-2 cursor-pointer transition-all hover:bg-accent hover:border-sidebar-primary/50',
                      isSelected ? 'border-primary bg-primary/5' : 'border-muted bg-card'
                    )}
                  >
                    <div className={cn('p-2 rounded-md mr-3', isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                      <PresetIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{wf.name}</p>
                      <p className="text-xs text-muted-foreground">{wf.desc}</p>
                    </div>
                    {isSelected && <Check className="h-4 w-4 text-primary" />}
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        )}

        <div className="rounded-lg border bg-muted/20 p-2.5 flex items-center gap-2">
          {SelectedWorkflowIcon ? (
            <div className="p-1.5 rounded-md bg-muted">
              <SelectedWorkflowIcon className="h-4 w-4" />
            </div>
          ) : (
            <div className="p-1.5 rounded-md bg-muted">
              <Sparkles className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{selectedWorkflow?.name || 'No workflow selected'}</p>
            <p className="text-xs text-muted-foreground truncate">
              {selectedWorkflow?.desc || 'Choose a workflow to start configuring steps.'}
            </p>
          </div>
          {selectedWorkflow && <Check className="h-4 w-4 text-primary shrink-0" />}
        </div>
        {useCompactWorkflowPicker && (
          <Button
            type="button"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setUseCompactWorkflowPicker(false)}
          >
            Show all workflows
          </Button>
        )}
      </div>

      {/* Guided Setup */}
      <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Configure Selected Steps</Label>
          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-background text-muted-foreground">
            {selectedSteps.length} selected
          </span>
        </div>
        {selectedSteps.length > 0 ? (
          <div className="grid grid-cols-1 gap-2">
            {selectedSteps.map((step) => (
              <div key={step.id} className="rounded-md border bg-background/70 p-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{step.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{step.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs shrink-0"
                  onClick={step.onClick}
                >
                  {step.actionLabel}
                  <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed bg-background/60 px-3 py-2 text-xs text-muted-foreground">
            No steps are enabled yet. Choose a workflow above, or enable steps from individual panels.
          </div>
        )}
      </div>

      {/* Active Steps Summary */}
      <div className="bg-muted/30 rounded-lg p-3 space-y-2 border">
        <Label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Active Steps</Label>
        <div className="flex flex-wrap gap-2 text-xs">
          {settings.enhancement.enabled && (
            <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-500 font-medium border border-blue-500/20">Enhancement</span>
          )}
          {settings.background.enabled && (
            <span className="px-2 py-1 rounded bg-green-500/10 text-green-500 font-medium border border-green-500/20">Background</span>
          )}
          {settings.security.enabled && (
            <span className="px-2 py-1 rounded bg-purple-500/10 text-purple-500 font-medium border border-purple-500/20">Security</span>
          )}
          {(!settings.enhancement.enabled && !settings.background.enabled && !settings.security.enabled) && (
            <span className="text-muted-foreground italic">No steps selected</span>
          )}
        </div>
      </div>

      {/* Parameter Summary */}
      <div className="bg-muted/30 rounded-lg p-3 space-y-2 border">
        <Label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Configured Parameters</Label>
        <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground">
          {settings.enhancement.enabled && (
            <div className="rounded-md border bg-background/60 px-2 py-1.5">
              <p className="font-medium text-foreground">Enhancement</p>
              <p>mode: {settings.enhancement.mode} · quality: {settings.enhancement.quality}</p>
              <p>restore: {settings.enhancement.restoreEnabled ? (settings.enhancement.restoreMode || 'auto') : 'off'} · face: {settings.enhancement.faceRestoration ? 'on' : 'off'}</p>
              <p>denoise: {settings.enhancement.denoiseStrength ?? 50} · deblur: {settings.enhancement.deblurStrength ?? 50}</p>
            </div>
          )}
          {settings.oldPhoto.enabled && (
            <div className="rounded-md border bg-background/60 px-2 py-1.5">
              <p className="font-medium text-foreground">Old Photo</p>
              <p>intent: {settings.oldPhoto.mode.replaceAll('_', ' ')}</p>
              <p>colorize: {settings.oldPhoto.colorize ? 'on' : 'off'} · repair broken: {settings.oldPhoto.repairBroken ? 'on' : 'off'}</p>
              <p>auto mask: {settings.oldPhoto.autoMaskDamage ? 'on' : 'off'} · model: {settings.oldPhoto.restoreMode}</p>
              <p>upscale: {settings.oldPhoto.upscaleEnabled ? `${settings.oldPhoto.upscaleFactor}x` : 'off'}</p>
              <p>face: {settings.oldPhoto.faceRestoration ? 'on' : 'off'} · strength: {settings.oldPhoto.faceStrength}%</p>
            </div>
          )}
          {settings.background.enabled && (
            <div className="rounded-md border bg-background/60 px-2 py-1.5">
              <p className="font-medium text-foreground">Background</p>
              <p>action: {settings.background.action} · type: {settings.background.type}</p>
              <p>edge smoothing: {settings.background.edgeSmoothing} · refine: {settings.background.refineEdges ? 'on' : 'off'}</p>
            </div>
          )}
          {settings.security.enabled && (
            <div className="rounded-md border bg-background/60 px-2 py-1.5">
              <p className="font-medium text-foreground">Security</p>
              <p>encryption: on · {settings.security.password ? 'password set' : 'password missing'}</p>
            </div>
          )}
          {!settings.enhancement.enabled && !settings.background.enabled && !settings.security.enabled && (
            <p className="italic">No parameters configured yet.</p>
          )}
        </div>
      </div>

      {/* Master Run Button */}
      <Button
        className="w-full h-12 text-base shadow-lg"
        size="lg"
        onClick={handleRunPipeline}
        disabled={!currentImage || isProcessing}
      >
        {isProcessing ? (
          <>Processing...</>
        ) : (
          <>
            Run Workflow <ChevronRight className="ml-2 h-4 w-4" />
          </>
        )}
      </Button>

        <ProcessConfirmDialog
          open={confirmOpen}
          title="Run workflow?"
          description="This will start the selected workflow with the current image settings."
          confirmLabel="Run Workflow"
          loading={isProcessing}
          onOpenChange={(open) => setConfirmOpen(open)}
          onConfirm={confirmRunPipeline}
        />
    </div>
  );
}
