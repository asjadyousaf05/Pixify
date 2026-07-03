import { useState } from 'react';
import { Eraser, ImageIcon, Palette, Droplets, Upload, Grid3X3, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useJob } from '@/contexts/JobContext';
import { useToast } from '@/hooks/use-toast';
import { BackgroundAction, BackgroundType } from '@/types';

const presetBackgrounds = [
  { id: 'gradient-1', name: 'Gradient Blue', url: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  { id: 'gradient-2', name: 'Gradient Sunset', url: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
  { id: 'gradient-3', name: 'Gradient Green', url: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
  { id: 'gradient-4', name: 'Gradient Purple', url: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)' },
  { id: 'solid-white', name: 'White', url: '#ffffff' },
  { id: 'solid-black', name: 'Black', url: '#000000' },
  { id: 'solid-gray', name: 'Gray', url: '#6b7280' },
  { id: 'solid-blue', name: 'Blue', url: '#3b82f6' },
];

export function BackgroundControls() {
  const { currentImage, settings, updateBackground, pipelineConfigMode, setPipelineConfigMode, setActivePanel } = useWorkspace();
  const { startJob, isProcessing } = useJob();
  const { toast } = useToast();
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const handleCustomBackgroundSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid background image',
        description: 'Please select a valid image file for custom background.',
        variant: 'destructive',
      });
      return;
    }

    const url = URL.createObjectURL(file);
    updateBackground({ customImageUrl: url });
    toast({
      title: 'Custom background selected',
      description: `${file.name} will be used for replacement.`,
    });
  };

  const handleRunBackground = () => {
    if (!currentImage) {
      toast({
        title: 'No image selected',
        description: 'Please upload an image first.',
        variant: 'destructive',
      });
      return;
    }

    if (settings.background.action === 'replace' && settings.background.type === 'custom' && !settings.background.customImageUrl) {
      toast({
        title: 'Custom background missing',
        description: 'Upload a custom background image before running replacement.',
        variant: 'destructive',
      });
      return;
    }

    const backgroundOnlySettings = {
      ...settings,
      enhancement: { ...settings.enhancement, enabled: false },
      background: { ...settings.background, enabled: true },
      security: { ...settings.security, enabled: false },
    };

    startJob(currentImage, backgroundOnlySettings);
    toast({
      title: 'Background processing started',
      description: 'Your image background is being processed.',
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Eraser className="h-4 w-4 text-success" />
          Background
        </CardTitle>
        <CardDescription className="text-xs">
          Remove or replace backgrounds
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Action Toggle */}
        <Tabs
          value={settings.background.action}
          onValueChange={(value) => {
            const action = value as BackgroundAction;
            if (action === 'remove') {
              const removeType: BackgroundType = settings.background.type === 'blur' ? 'blur' : 'transparent';
              updateBackground({ action, type: removeType });
              return;
            }

            const replaceType: BackgroundType =
              settings.background.type === 'solid' ||
              settings.background.type === 'preset' ||
              settings.background.type === 'custom'
                ? settings.background.type
                : 'solid';
            updateBackground({ action, type: replaceType });
          }}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="remove">Remove</TabsTrigger>
            <TabsTrigger value="replace">Replace</TabsTrigger>
          </TabsList>

          <TabsContent value="remove" className="mt-4 space-y-4">
            {/* Output type for removal */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Output</Label>
              <RadioGroup
                value={settings.background.type}
                onValueChange={(value) => updateBackground({ type: value as BackgroundType })}
                className="grid grid-cols-2 gap-2"
              >
                <div>
                  <RadioGroupItem value="transparent" id="bg-transparent" className="peer sr-only" />
                  <Label
                    htmlFor="bg-transparent"
                    className="flex items-center justify-center gap-2 rounded-lg border-2 border-muted bg-popover p-3 hover:bg-accent cursor-pointer text-xs peer-data-[state=checked]:border-primary"
                  >
                    <Grid3X3 className="h-4 w-4" />
                    Transparent
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="blur" id="bg-blur" className="peer sr-only" />
                  <Label
                    htmlFor="bg-blur"
                    className="flex items-center justify-center gap-2 rounded-lg border-2 border-muted bg-popover p-3 hover:bg-accent cursor-pointer text-xs peer-data-[state=checked]:border-primary"
                  >
                    <Droplets className="h-4 w-4" />
                    Blur
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {settings.background.type === 'blur' && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Blur Amount: {settings.background.blurAmount || 10}px
                </Label>
                <Slider
                  value={[settings.background.blurAmount || 10]}
                  onValueChange={([value]) => updateBackground({ blurAmount: value })}
                  min={0}
                  max={30}
                  step={1}
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="replace" className="mt-4 space-y-4">
            {/* Background type for replacement */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Replace With</Label>
              <RadioGroup
                value={settings.background.type}
                onValueChange={(value) => updateBackground({ type: value as BackgroundType })}
                className="grid grid-cols-3 gap-2"
              >
                <div>
                  <RadioGroupItem value="solid" id="bg-solid" className="peer sr-only" />
                  <Label
                    htmlFor="bg-solid"
                    className="flex items-center justify-center gap-1 rounded-lg border-2 border-muted bg-popover p-2 hover:bg-accent cursor-pointer text-[10px] peer-data-[state=checked]:border-primary"
                  >
                    <Palette className="h-3 w-3" />
                    Solid
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="preset" id="bg-preset" className="peer sr-only" />
                  <Label
                    htmlFor="bg-preset"
                    className="flex items-center justify-center gap-1 rounded-lg border-2 border-muted bg-popover p-2 hover:bg-accent cursor-pointer text-[10px] peer-data-[state=checked]:border-primary"
                  >
                    <ImageIcon className="h-3 w-3" />
                    Preset
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="custom" id="bg-custom" className="peer sr-only" />
                  <Label
                    htmlFor="bg-custom"
                    className="flex items-center justify-center gap-1 rounded-lg border-2 border-muted bg-popover p-2 hover:bg-accent cursor-pointer text-[10px] peer-data-[state=checked]:border-primary"
                  >
                    <Upload className="h-3 w-3" />
                    Custom
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Solid color picker */}
            {settings.background.type === 'solid' && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={settings.background.color || '#ffffff'}
                    onChange={(e) => updateBackground({ color: e.target.value })}
                    className="w-12 h-10 p-1 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={settings.background.color || '#ffffff'}
                    onChange={(e) => updateBackground({ color: e.target.value })}
                    className="flex-1 font-mono text-xs"
                    placeholder="#ffffff"
                  />
                </div>
              </div>
            )}

            {/* Preset backgrounds grid */}
            {settings.background.type === 'preset' && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Preset Backgrounds</Label>
                <div className="grid grid-cols-4 gap-2">
                  {presetBackgrounds.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => {
                        setSelectedPreset(preset.id);
                        updateBackground({ presetId: preset.id });
                      }}
                      className={`
                        relative aspect-square rounded-lg border-2 transition-all overflow-hidden
                        ${selectedPreset === preset.id || settings.background.presetId === preset.id
                          ? 'border-primary ring-2 ring-primary/20'
                          : 'border-muted hover:border-muted-foreground/50'
                        }
                      `}
                      title={preset.name}
                    >
                      <div
                        className="absolute inset-0"
                        style={{
                          background: preset.url.startsWith('linear-gradient') 
                            ? preset.url 
                            : preset.url,
                        }}
                      />
                      {(selectedPreset === preset.id || settings.background.presetId === preset.id) && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <Check className="h-4 w-4 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Custom background upload */}
            {settings.background.type === 'custom' && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Custom Background</Label>
                <label className="block border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/50">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleCustomBackgroundSelect}
                  />
                  <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground">
                    Click to upload background image
                  </p>
                  {settings.background.customImageUrl && (
                    <p className="text-[11px] text-primary mt-2">Custom background ready</p>
                  )}
                </label>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Edge refinement */}
        <div className="space-y-3 pt-2 border-t">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Edge Smoothing</Label>
            <span className="text-xs text-muted-foreground">{settings.background.edgeSmoothing}%</span>
          </div>
          <Slider
            value={[settings.background.edgeSmoothing]}
            onValueChange={([value]) => updateBackground({ edgeSmoothing: value })}
            min={0}
            max={100}
            step={5}
          />
          
          <div className="flex items-center justify-between">
            <Label htmlFor="refine-edges" className="text-xs">Refine Edges</Label>
            <Switch
              id="refine-edges"
              checked={settings.background.refineEdges}
              onCheckedChange={(checked) => updateBackground({ refineEdges: checked })}
            />
          </div>
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
            variant="outline"
            className="w-full"
            onClick={handleRunBackground}
            disabled={!currentImage || isProcessing}
          >
            <Eraser className="mr-2 h-4 w-4" />
            Run Background Only
          </Button>
        )}

      </CardContent>
    </Card>
  );
}
