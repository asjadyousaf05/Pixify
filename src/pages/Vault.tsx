import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Search, 
  Filter, 
  Download, 
  Link as LinkIcon, 
  Trash2, 
  Eye, 
  Sparkles, 
  Eraser, 
  Lock,
  FolderOpen,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { vaultService } from '@/services/vault.service';
import { VaultItem } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow, format } from 'date-fns';

type FilterType = 'all' | 'enhancement' | 'background' | 'encryption';

export default function Vault() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadVaultItems();
    }
  }, [user]);

  const loadVaultItems = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const data = await vaultService.getVaultItems(user.id);
      setItems(data);
    } catch (error) {
      toast({
        title: 'Failed to load vault',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (itemId: string) => {
    if (!user) return;
    try {
      await vaultService.deleteFromVault(user.id, itemId);
      setItems(prev => prev.filter(item => item.id !== itemId));
      toast({
        title: 'Item deleted',
        description: 'The item has been removed from your vault.',
      });
    } catch (error) {
      toast({
        title: 'Failed to delete',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
    setDeleteTarget(null);
  };

  const handleCopyLink = async (itemId: string) => {
    try {
      const link = await vaultService.generateShareLink(itemId, '24h');
      navigator.clipboard.writeText(link);
      toast({
        title: 'Link copied',
        description: 'Share link copied to clipboard.',
      });
    } catch (error) {
      toast({
        title: 'Failed to generate link',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const filteredItems = items.filter(item => {
    // Filter by operation type
    if (filter !== 'all' && !item.operations.includes(filter)) {
      return false;
    }
    // Filter by search query
    if (searchQuery && !item.job.originalImage.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  const getOperationIcon = (op: string) => {
    switch (op) {
      case 'enhancement': return <Sparkles className="h-3 w-3" />;
      case 'background': return <Eraser className="h-3 w-3" />;
      case 'encryption': return <Lock className="h-3 w-3" />;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      
      <main className="flex-1 container px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">My Vault</h1>
          <p className="text-muted-foreground">
            View and manage your processed images. Items are stored for 7 days.
          </p>
        </div>

        {/* Filters and Search */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by filename..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="enhancement">Enhanced</TabsTrigger>
              <TabsTrigger value="background">Background</TabsTrigger>
              <TabsTrigger value="encryption">Encrypted</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="aspect-video rounded-lg mb-3" />
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <FolderOpen className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold mb-2">
              {searchQuery || filter !== 'all' ? 'No matching items' : 'No processed images yet'}
            </h3>
            <p className="text-muted-foreground max-w-sm mb-6">
              {searchQuery || filter !== 'all' 
                ? 'Try adjusting your search or filters.'
                : 'Start processing images in the workspace to see them here.'}
            </p>
            <Link to="/app">
              <Button className="gradient-primary">
                Go to Workspace
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredItems.map((item) => (
              <Card key={item.id} className="group overflow-hidden">
                <CardContent className="p-0">
                  {/* Thumbnail */}
                  <div className="relative aspect-video bg-muted">
                    <img
                      src={item.thumbnail}
                      alt={item.job.originalImage.name}
                      className="w-full h-full object-cover"
                    />
                    
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <Button size="icon" variant="secondary" className="h-8 w-8">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button 
                        size="icon" 
                        variant="secondary" 
                        className="h-8 w-8"
                        onClick={() => toast({ title: 'Download started' })}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button 
                        size="icon" 
                        variant="secondary" 
                        className="h-8 w-8"
                        onClick={() => handleCopyLink(item.id)}
                      >
                        <LinkIcon className="h-4 w-4" />
                      </Button>
                      <Button 
                        size="icon" 
                        variant="secondary" 
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Operation badges */}
                    <div className="absolute top-2 right-2 flex gap-1">
                      {item.operations.map((op) => (
                        <div
                          key={op}
                          className="w-6 h-6 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white"
                        >
                          {getOperationIcon(op)}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <h4 className="font-medium text-sm truncate mb-1">
                      {item.job.originalImage.name}
                    </h4>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(item.createdAt, { addSuffix: true })}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        Expires {format(item.expiresAt, 'MMM d')}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The processed image will be permanently removed from your vault.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
