import { useState, useRef } from 'react';
import { LockOpen, Eye, EyeOff, Loader, Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/hooks/use-toast';

interface DecryptModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DecryptModal({ isOpen, onClose }: DecryptModalProps) {
  const { setDecryptedPreview } = useWorkspace();
  const { toast } = useToast();
  
  const [decryptFile, setDecryptFile] = useState<File | null>(null);
  const [decryptPassword, setDecryptPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://127.0.0.1:8000';

  const canDecrypt = decryptFile && decryptPassword.trim() && !isDecrypting;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.match(/\.(bin|enc)$/i)) {
        toast({
          title: 'Invalid file',
          description: 'Please select a .bin or .enc encrypted file.',
          variant: 'destructive',
        });
        return;
      }
      setDecryptFile(file);
    }
  };

  const handleDecrypt = async () => {
    if (!decryptFile) {
      toast({
        title: 'Encrypted file required',
        description: 'Upload a .bin or .enc file first.',
        variant: 'destructive',
      });
      return;
    }

    if (!decryptPassword.trim()) {
      toast({
        title: 'Password required',
        description: 'Enter the encryption password to decrypt.',
        variant: 'destructive',
      });
      return;
    }

    setIsDecrypting(true);
    try {
      const form = new FormData();
      form.append('file', decryptFile);
      form.append('password', decryptPassword);

      const response = await fetch(`${API_BASE_URL}/api/decrypt`, {
        method: 'POST',
        body: form,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to decrypt file');
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || 'decrypted-image.png';

      const url = URL.createObjectURL(blob);
      setDecryptedPreview(url, filename);

      // Auto-download
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      toast({
        title: 'Decryption successful',
        description: 'Image decrypted and preview shown in workspace.',
      });

      onClose();
      setDecryptFile(null);
      setDecryptPassword('');
    } catch (err) {
      toast({
        title: 'Decryption failed',
        description: err instanceof Error ? err.message : 'Unable to decrypt file.',
        variant: 'destructive',
      });
    } finally {
      setIsDecrypting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockOpen className="h-5 w-5" />
            Decrypt Image
          </DialogTitle>
          <DialogDescription>
            Upload an encrypted file (.bin or .enc) produced by the workspace pipeline and enter the password to decrypt.
            <span className="block mt-1 text-xs text-amber-600 dark:text-amber-400">Note: This decrypts files from the workspace &quot;Encrypt Output&quot; pipeline. For standalone AES-encrypted files, use the dedicated AES Encryption page.</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Upload */}
          <div className="space-y-2">
            <Label htmlFor="decrypt-file">Encrypted File</Label>
            <div className="relative">
              <input
                ref={fileInputRef}
                id="decrypt-file"
                type="file"
                accept=".bin,.enc"
                onChange={handleFileSelect}
                disabled={isDecrypting}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isDecrypting}
                className="w-full px-3 py-2 border border-dashed border-input rounded-md hover:border-primary hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <Upload className="h-4 w-4" />
                {decryptFile ? decryptFile.name : 'Click to select .bin or .enc file'}
              </button>
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-2">
            <Label htmlFor="decrypt-password">Password</Label>
            <div className="relative">
              <Input
                id="decrypt-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter encryption password"
                value={decryptPassword}
                onChange={(e) => setDecryptPassword(e.target.value)}
                disabled={isDecrypting}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isDecrypting}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* File Info */}
          {decryptFile && (
            <div className="text-sm p-2 rounded bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
              File: {decryptFile.name} ({(decryptFile.size / 1024).toFixed(2)} KB)
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isDecrypting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDecrypt}
              disabled={!canDecrypt}
              className="gap-2"
            >
              {isDecrypting && <Loader className="h-4 w-4 animate-spin" />}
              {isDecrypting ? 'Decrypting...' : 'Decrypt Image'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
