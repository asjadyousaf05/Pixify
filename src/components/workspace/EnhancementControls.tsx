import { useState } from 'react';
import { Sparkles, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useJob } from '@/contexts/JobContext';
import { useToast } from '@/hooks/use-toast';
import { EnhancementMode, QualityLevel } from '@/types';
import { ProcessConfirmDialog } from './ProcessConfirmDialog';

export function EnhancementControls() {
  const { currentImage, settings, updateEnhancement, pipelineConfigMode, setPipelineConfigMode, setActivePanel } = useWorkspace();
  const { startJob, isProcessing } = useJob();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleRunEnhancement = () => {
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

  const confirmRunEnhancement = () => {
    if (!currentImage) return;

    const enhancementOnlySettings = {
      ...settings,
      enhancement: { ...settings.enhancement, enabled: true },
      background: { ...settings.background, enabled: false },
      security: { ...settings.security, enabled: false },
    };

    startJob(currentImage, enhancementOnlySettings);
    toast({
      title: 'Enhancement started',
      description: 'Your image is being enhanced.',
    });
    setConfirmOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Upscaling Section */}
      <div className="space-y-3">
        <Label className="text-sm font-medium flex items-center gap-2">
          <ArrowUpRight className="h-4 w-4" />
          Upscaling
        </Label>
        <ToggleGroup
          type="single"
          value={settings.enhancement.mode}
          onValueChange={(value) => {
            if (value) updateEnhancement({ mode: value as EnhancementMode });
          }}
          className="justify-start"
        >
          <ToggleGroupItem value="auto" aria-label="Off" className="px-4">
            Off
          </ToggleGroupItem>
          <ToggleGroupItem value="upscale2x" aria-label="2x" className="px-4">
            2x
          </ToggleGroupItem>
          <ToggleGroupItem value="upscale4x" aria-label="4x" className="px-4">
            4x
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          AI restoration for old, noisy, or blurry images is now in the dedicated Old Photo AI tab.
        </p>
      </div>

      {/* Quality Settings */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Processing Quality</Label>
        <ToggleGroup
          type="single"
          value={settings.enhancement.quality}
          onValueChange={(v) => v && updateEnhancement({ quality: v as QualityLevel })}
          className="w-full justify-between"
        >
          <ToggleGroupItem value="fast" className="flex-1 text-xs">Fast</ToggleGroupItem>
          <ToggleGroupItem value="balanced" className="flex-1 text-xs">Balanced</ToggleGroupItem>
          <ToggleGroupItem value="high" className="flex-1 text-xs">High Quality</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {pipelineConfigMode ? (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            setPipelineConfigMode(false);
            setActivePanel('pipeline');
          }}
        >
          Back to Pipeline
        </Button>
      ) : (
        <Button
          className="w-full"
          onClick={handleRunEnhancement}
          disabled={!currentImage || isProcessing}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Enhance
        </Button>
      )}

      {!pipelineConfigMode && (
        <ProcessConfirmDialog
          open={confirmOpen}
          title="Run enhancement?"
          description="This will start the enhancement workflow using the current settings."
          confirmLabel="Start Enhancement"
          loading={isProcessing}
          onOpenChange={(open) => setConfirmOpen(open)}
          onConfirm={confirmRunEnhancement}
        />
      )}
    </div>
  );
}
