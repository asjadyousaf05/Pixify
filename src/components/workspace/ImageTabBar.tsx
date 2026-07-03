import { useCallback, useRef } from 'react';
import { X, Plus, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useJob } from '@/contexts/JobContext';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const MAX_OPEN_IMAGES = 5;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function ImageTabBar() {
  const { openImages, activeImageId, setActiveImage, removeImage, addImage } = useWorkspace();
  const { isProcessing } = useJob();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isFull = openImages.length >= MAX_OPEN_IMAGES;

  const handleAddClick = useCallback(() => {
    if (isFull) {
      toast({
        title: 'Maximum images reached',
        description: `You can only have ${MAX_OPEN_IMAGES} images open at a time. Close a tab to add more.`,
        variant: 'destructive',
      });
      return;
    }
    fileInputRef.current?.click();
  }, [isFull, toast]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be selected again
    e.target.value = '';

    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast({ title: 'Invalid file type', description: 'Please upload a JPG, PNG, or WebP image.', variant: 'destructive' });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: 'File too large', description: 'Maximum file size is 10MB.', variant: 'destructive' });
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const imageFile = {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        url,
        file,
        size: file.size,
        width: img.width,
        height: img.height,
        format: file.type,
      };
      const added = addImage(imageFile);
      if (!added) {
        URL.revokeObjectURL(url);
        toast({ title: 'Maximum images reached', description: `Close a tab to add more images.`, variant: 'destructive' });
      }
    };
    img.src = url;
  }, [addImage, toast]);

  const handleClose = useCallback((e: React.MouseEvent, imageId: string) => {
    e.stopPropagation();
    removeImage(imageId);
  }, [removeImage]);

  const formatName = (name: string) => {
    if (name.length <= 18) return name;
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    const base = name.slice(0, name.lastIndexOf('.') || undefined);
    return base.slice(0, 14) + '…' + ext;
  };

  if (openImages.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 bg-muted/40 border-b overflow-x-auto scrollbar-thin">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        onChange={handleFileSelect}
        className="hidden"
      />

      {openImages.map((image, index) => {
        const isActive = image.id === activeImageId;
        return (
          <button
            key={image.id}
            onClick={() => setActiveImage(image.id)}
            className={cn(
              'group relative flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 min-w-0 max-w-[180px] shrink-0',
              'hover:bg-background/80',
              isActive
                ? 'bg-background text-foreground shadow-sm border border-border/60'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {/* Tiny thumbnail */}
            <div className="w-5 h-5 rounded-sm overflow-hidden bg-muted shrink-0 ring-1 ring-border/30">
              <img
                src={image.url}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
              />
            </div>

            {/* Filename */}
            <span className="truncate select-none">{formatName(image.name)}</span>

            {/* Close button */}
            <TooltipProvider delayDuration={400}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleClose(e, image.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleClose(e as unknown as React.MouseEvent, image.id);
                      }
                    }}
                    className={cn(
                      'ml-auto shrink-0 rounded-sm p-0.5 transition-colors',
                      'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                      isActive && 'opacity-60',
                      'hover:bg-destructive/15 hover:text-destructive',
                    )}
                  >
                    <X className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {isProcessing && image.id === activeImageId
                    ? 'Close & cancel processing'
                    : 'Close image'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </button>
        );
      })}

      {/* Add button */}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 rounded-md shrink-0 ml-0.5',
                isFull && 'opacity-40 cursor-not-allowed',
              )}
              onClick={handleAddClick}
              disabled={isFull}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {isFull ? `${MAX_OPEN_IMAGES}/${MAX_OPEN_IMAGES} images open` : 'Add another image'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Slot counter */}
      <span className="ml-auto text-[10px] text-muted-foreground/60 shrink-0 pr-1 select-none">
        {openImages.length}/{MAX_OPEN_IMAGES}
      </span>
    </div>
  );
}
