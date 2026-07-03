import { useState } from 'react';
import { Lock, Eye, EyeOff, Link as LinkIcon, Copy, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { ExpiryDuration } from '@/types';

export function SecurityControls() {
  const { settings, updateSecurity, shareLinkExpiry, setShareLinkExpiry, pipelineConfigMode, setPipelineConfigMode, setActivePanel } = useWorkspace();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');

  const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://127.0.0.1:8000';

  const isGuest = !isAuthenticated || user?.role === 'guest';
  const passwordsMatch = password === confirmPassword;
  const hasValidPassword = password.length >= 6 && passwordsMatch;

  const handleGenerateLink = async () => {
    if (isGuest) {
      toast({
        title: 'Login required',
        description: 'Please login to generate share links.',
        variant: 'destructive',
      });
      return;
    }

    // Mock link generation
    const token = btoa(`share-${Date.now()}-${shareLinkExpiry}`).replace(/=/g, '');
    const link = `https://pixify.app/share/${token}`;
    setGeneratedLink(link);
    
    toast({
      title: 'Share link generated',
      description: `Link expires in ${shareLinkExpiry === '1h' ? '1 hour' : shareLinkExpiry === '24h' ? '24 hours' : '7 days'}.`,
    });
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(generatedLink);
    toast({
      title: 'Link copied',
      description: 'Share link copied to clipboard.',
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Lock className="h-4 w-4 text-info" />
          Security
        </CardTitle>
        <CardDescription className="text-xs">
          Encrypt and share securely
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Encryption Toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center">
              <Lock className="h-4 w-4 text-info" />
            </div>
            <div>
              <Label className="text-sm font-medium">Encrypt Output</Label>
              <p className="text-xs text-muted-foreground">AES-256 encryption</p>
            </div>
          </div>
          <Switch
            checked={settings.security.enabled}
            onCheckedChange={(checked) => updateSecurity({ enabled: checked })}
          />
        </div>

        {/* Password Fields */}
        {settings.security.enabled && (
          <div className="space-y-3 animate-fade-in">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Encryption Password</Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    updateSecurity({ password: e.target.value });
                  }}
                  placeholder="Enter password (min 6 characters)"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Confirm Password</Label>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className={!passwordsMatch && confirmPassword ? 'border-destructive' : ''}
              />
              {!passwordsMatch && confirmPassword && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Passwords do not match
                </p>
              )}
            </div>
          </div>
        )}

        {/* Share Link Section */}
        <div className="pt-3 border-t space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Secure Share Link</Label>
            {isGuest && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <span className="text-xs text-muted-foreground cursor-help underline decoration-dashed">
                      Login required
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Login to generate expiring share links</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          <div className="flex gap-2">
            <Select
              value={shareLinkExpiry}
              onValueChange={(value) => setShareLinkExpiry(value as ExpiryDuration)}
              disabled={isGuest}
            >
              <SelectTrigger className="w-28">
                <Clock className="h-3 w-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">1 hour</SelectItem>
                <SelectItem value="24h">24 hours</SelectItem>
                <SelectItem value="7d">7 days</SelectItem>
              </SelectContent>
            </Select>
            
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleGenerateLink}
              disabled={isGuest}
            >
              <LinkIcon className="mr-2 h-4 w-4" />
              Generate Link
            </Button>
          </div>

          {/* Generated Link Display */}
          {generatedLink && (
            <div className="flex gap-2 animate-fade-in">
              <Input
                value={generatedLink}
                readOnly
                className="flex-1 text-xs font-mono"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyLink}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {pipelineConfigMode && (
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
        )}
      </CardContent>
    </Card>
  );
}
