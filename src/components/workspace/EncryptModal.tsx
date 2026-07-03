import { useState } from 'react';
import { Lock, Eye, EyeOff, Loader } from 'lucide-react';
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
import { useJob } from '@/contexts/JobContext';
import { useToast } from '@/hooks/use-toast';

interface EncryptModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EncryptModal({ isOpen, onClose }: EncryptModalProps) {
  const { currentImage, settings, updateEnhancement, updateBackground, updateSecurity } = useWorkspace();
  const { startJob, isProcessing } = useJob();
  const { toast } = useToast();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);

  const passwordsMatch = password === confirmPassword;
  const hasValidPassword = password.length >= 6 && passwordsMatch;
  const isLoading = isProcessing || isEncrypting;

  const handleEncrypt = async () => {
    if (!password.trim()) {
      toast({
        title: 'Password required',
        description: 'Enter a password to encrypt your image.',
        variant: 'destructive',
      });
      return;
    }

    if (!hasValidPassword) {
      toast({
        title: 'Password mismatch',
        description: 'Passwords must match and be at least 6 characters.',
        variant: 'destructive',
      });
      return;
    }

    if (!currentImage) {
      toast({
        title: 'No image selected',
        description: 'Upload an image first.',
        variant: 'destructive',
      });
      return;
    }

    setIsEncrypting(true);
    try {
      updateEnhancement({ enabled: false });
      updateBackground({ enabled: false });
      updateSecurity({ enabled: true, password });

      const jobSettings = {
        enhancement: { enabled: false, mode: 'auto' as const, quality: 'balanced' as const },
        oldPhoto: { enabled: false, mode: 'repair_only' as const, colorize: false, repairBroken: false, autoMaskDamage: true, restoreMode: 'auto' as const, faceRestoration: false, faceStrength: 60, denoiseStrength: 35, deblurStrength: 50, upscaleEnabled: false, upscaleFactor: 2 as const },
        background: { enabled: false, action: 'remove' as const, type: 'transparent' as const, edgeSmoothing: 50, refineEdges: true },
        security: { enabled: true, password },
      };

      startJob(currentImage, jobSettings);

      toast({
        title: 'Encryption started',
        description: 'Your image is being encrypted with AES-256-GCM.',
      });

      onClose();
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast({
        title: 'Encryption failed',
        description: err instanceof Error ? err.message : 'Unable to start encryption.',
        variant: 'destructive',
      });
    } finally {
      setIsEncrypting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Encrypt Image
          </DialogTitle>
          <DialogDescription>
            Set a password to encrypt your image with AES-256-GCM
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Password Input */}
          <div className="space-y-2">
            <Label htmlFor="encrypt-password">Password</Label>
            <div className="relative">
              <Input
                id="encrypt-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter password (min 6 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
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

          {/* Confirm Password Input */}
          <div className="space-y-2">
            <Label htmlFor="encrypt-confirm">Confirm Password</Label>
            <div className="relative">
              <Input
                id="encrypt-confirm"
                type={showPassword ? 'text' : 'password'}
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isLoading}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
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

          {/* Password Status */}
          {password && (
            <div className={`text-sm p-2 rounded ${
              hasValidPassword
                ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
            }`}>
              {passwordsMatch
                ? '✓ Passwords match'
                : '✗ Passwords do not match'}
              {password.length < 6 && ' • Password too short'}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEncrypt}
              disabled={!hasValidPassword || isLoading}
              className="gap-2"
            >
              {isLoading && <Loader className="h-4 w-4 animate-spin" />}
              {isLoading ? 'Encrypting...' : 'Encrypt Image'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
