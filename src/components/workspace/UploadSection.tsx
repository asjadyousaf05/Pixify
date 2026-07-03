import { useCallback, useState } from 'react';
import { Upload, ImageIcon, X, FileType, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { ImageFile } from '@/types';
import { useToast } from '@/hooks/use-toast';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_OPEN_IMAGES = 5;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface UploadSectionProps {
  compact?: boolean;
}

export function UploadSection({ compact = false }: UploadSectionProps) {
  const [isDragging, setIsDragging] = useState(false);
  const { currentImage, openImages, addImage, removeImage, activeImageId } = useWorkspace();
  const { toast } = useToast();
  const isFull = openImages.length >= MAX_OPEN_IMAGES;

  const processFile = useCallback((file: File) => {
    // Validate file type
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a JPG, PNG, or WebP image.',
        variant: 'destructive',
      });
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: 'File too large',
        description: 'Maximum file size is 10MB.',
        variant: 'destructive',
      });
      return;
    }

    if (isFull) {
      toast({
        title: 'Maximum images reached',
        description: `You can have up to ${MAX_OPEN_IMAGES} images open. Close a tab to add more.`,
        variant: 'destructive',
      });
      return;
    }

    // Create object URL and get image dimensions
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const imageFile: ImageFile = {
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
      if (added) {
        toast({
          title: 'Image uploaded',
          description: `${file.name} is ready for processing.`,
        });
      } else {
        URL.revokeObjectURL(url);
        toast({
          title: 'Maximum images reached',
          description: `Close a tab to add more images.`,
          variant: 'destructive',
        });
      }
    };
    img.src = url;
  }, [addImage, isFull, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      processFile(file);
    }
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    // Reset so same file can be re-uploaded
    e.target.value = '';
  }, [processFile]);

  const handleRemoveImage = useCallback(() => {
    if (activeImageId) {
      removeImage(activeImageId);
    }
  }, [activeImageId, removeImage]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  return (
    <Card className={compact ? "shadow-sm" : ""}>
      <CardHeader className={compact ? "pb-2 p-4" : "pb-3"}>
        <CardTitle className={`${compact ? "text-sm" : "text-base"} flex items-center gap-2`}>
          <Upload className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          Upload Image
          {openImages.length > 0 && (
            <span className="ml-auto text-[10px] font-normal text-muted-foreground">
              {openImages.length}/{MAX_OPEN_IMAGES}
            </span>
          )}
        </CardTitle>
        <CardDescription className={compact ? "text-[11px]" : "text-xs"}>
          JPG, PNG, WebP up to 10MB
        </CardDescription>
      </CardHeader>
      <CardContent className={compact ? "p-4 pt-0" : ""}>
        {!currentImage ? (
          <div
            className={`
              relative border-2 border-dashed rounded-lg text-center transition-colors cursor-pointer
              ${compact ? "p-4" : "p-6"}
              ${isDragging 
                ? 'border-primary bg-primary/5' 
                : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'
              }
            `}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => document.getElementById('file-upload')?.click()}
          >
            <input
              id="file-upload"
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className={`flex flex-col items-center ${compact ? "gap-1.5" : "gap-2"}`}>
              <div className={`${compact ? "w-10 h-10" : "w-12 h-12"} rounded-full bg-primary/10 flex items-center justify-center`}>
                <ImageIcon className={compact ? "h-5 w-5 text-primary" : "h-6 w-6 text-primary"} />
              </div>
              <div>
                <p className={compact ? "text-xs font-medium" : "text-sm font-medium"}>
                  Drop your image here
                </p>
                <p className={compact ? "text-[11px] text-muted-foreground" : "text-xs text-muted-foreground"}>
                  or click to browse
                </p>
              </div>
            </div>
          </div>
        ) : compact ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-dashed bg-muted/30 px-2.5 py-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium truncate">{currentImage.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {currentImage.width} x {currentImage.height}px - {formatFileSize(currentImage.size)}
              </p>
            </div>
            <Button
              variant="destructive"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={handleRemoveImage}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Thumbnail preview */}
            <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
              <img
                src={currentImage.url}
                alt="Uploaded"
                className="w-full h-full object-contain"
              />
              <Button
                variant="destructive"
                size="icon"
                className="absolute top-2 right-2 h-6 w-6"
                onClick={handleRemoveImage}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>

            {/* File metadata */}
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <FileType className="h-3 w-3" />
                <span className="truncate flex-1">{currentImage.name}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Ruler className="h-3 w-3" />
                <span>{currentImage.width} x {currentImage.height}px</span>
                <span className="text-muted-foreground/50">-</span>
                <span>{formatFileSize(currentImage.size)}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
