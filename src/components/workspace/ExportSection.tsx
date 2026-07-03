import { Download, FileImage, Package, FileType } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useJob } from '@/contexts/JobContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { ExportFormat } from '@/types';

export function ExportSection() {
  const { exportFormat, setExportFormat, settings } = useWorkspace();
  const { currentJob } = useJob();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();

  const isGuest = !isAuthenticated || user?.role === 'guest';
  const isCompleted = currentJob?.status === 'completed';

  const handleDownload = async (type: 'enhanced' | 'background' | 'encrypted') => {
    const url = type === 'enhanced'
      ? currentJob?.enhancedImageUrl
      : type === 'background'
        ? currentJob?.backgroundEditedUrl
        : currentJob?.encryptedPackageUrl;

    if (!url) {
      toast({
        title: 'File unavailable',
        description: `No ${type} artifact is available for this job.`,
        variant: 'destructive',
      });
      return;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const ext = type === 'encrypted' ? 'bin' : exportFormat;
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${currentJob?.id || 'job'}-${type}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);

      toast({
        title: 'Download complete',
        description: `${type.charAt(0).toUpperCase() + type.slice(1)} file downloaded successfully.`,
      });
    } catch {
      toast({
        title: 'Download failed',
        description: `Could not download ${type} artifact.`,
        variant: 'destructive',
      });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Download className="h-4 w-4" />
          Export
        </CardTitle>
        <CardDescription className="text-xs">
          Download processed images
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Format Selector */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Format</Label>
          <Select
            value={exportFormat}
            onValueChange={(value) => setExportFormat(value as ExportFormat)}
          >
            <SelectTrigger>
              <FileType className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="png">PNG (Lossless)</SelectItem>
              <SelectItem value="jpg">JPG (Compressed)</SelectItem>
              <SelectItem value="webp">WebP (Modern)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Download Buttons */}
        <div className="space-y-2">
          {currentJob?.enhancedImageUrl && (
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => handleDownload('enhanced')}
              disabled={!isCompleted}
            >
              <FileImage className="mr-2 h-4 w-4 text-primary" />
              Download Enhanced Image
            </Button>
          )}
          
          {currentJob?.backgroundEditedUrl && (
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => handleDownload('background')}
              disabled={!isCompleted}
            >
              <FileImage className="mr-2 h-4 w-4 text-success" />
              Download Background Edit
            </Button>
          )}
          
          {currentJob?.encryptedPackageUrl && (
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => handleDownload('encrypted')}
              disabled={!isCompleted}
            >
              <Package className="mr-2 h-4 w-4 text-info" />
              Download Encrypted Package
            </Button>
          )}
        </div>

        {/* Storage notice */}
        <div className="p-3 rounded-lg bg-muted text-xs text-muted-foreground">
          {isGuest ? (
            <p>⏱️ Files auto-delete after 1 hour (Guest)</p>
          ) : (
            <p>📦 Stored for 7 days in your Vault</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
