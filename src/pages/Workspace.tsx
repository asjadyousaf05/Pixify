import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";

import { useState } from 'react';
import { Menu, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Wand2, Layers, Shield, Settings2, Download, ArrowLeft, ArchiveRestore } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { ActionButtons } from '@/components/workspace/ActionButtons';
import { PipelineSection } from '@/components/workspace/PipelineSection';
import { EnhancementControls } from '@/components/workspace/EnhancementControls';
import { RestorationControls } from '@/components/workspace/RestorationControls';
import { BackgroundControls } from '@/components/workspace/BackgroundControls';
import { SecurityControls } from '@/components/workspace/SecurityControls';
import { ExportSection } from '@/components/workspace/ExportSection';
import { ImagePreview } from '@/components/workspace/ImagePreview';
import { JobProgress, ResultMetrics } from '@/components/workspace/JobProgress';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useWorkspace, type WorkspacePanel } from '@/contexts/WorkspaceContext';
import { useJob } from '@/contexts/JobContext';
import { useNavigate } from 'react-router-dom';

function SidebarContent() {
  const { settings, activePanel, setActivePanel } = useWorkspace();

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
        <Tabs value={activePanel} onValueChange={(value) => setActivePanel(value as WorkspacePanel)} className="h-full flex flex-col">
          <div className="px-4 pt-4 pb-2">
            <TabsList className="grid w-full grid-cols-5 h-auto py-1">
              <TabsTrigger value="pipeline" title="Pipeline" className="px-1 py-1.5"><Settings2 className="h-4 w-4" /></TabsTrigger>
              <TabsTrigger value="enhancement" disabled={!settings.enhancement.enabled} title="Enhancement" className="px-1 py-1.5"><Wand2 className="h-4 w-4" /></TabsTrigger>
              <TabsTrigger value="restoration" title="Old Photo Restoration" className="px-1 py-1.5"><ArchiveRestore className="h-4 w-4" /></TabsTrigger>
              <TabsTrigger value="background" disabled={!settings.background.enabled} title="Background" className="px-1 py-1.5"><Layers className="h-4 w-4" /></TabsTrigger>
              <TabsTrigger value="security" disabled={!settings.security.enabled} title="Security" className="px-1 py-1.5"><Shield className="h-4 w-4" /></TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 px-4 overflow-y-auto">
            <TabsContent value="pipeline" className="mt-0 pb-4">
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Processing Pipeline</h3>
                <PipelineSection />
              </div>
            </TabsContent>

            <TabsContent value="enhancement" className="mt-0 pb-4">
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Enhancement Controls</h3>
                <EnhancementControls />
              </div>
            </TabsContent>

            <TabsContent value="restoration" className="mt-0 pb-4">
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Old Photo AI Restoration</h3>
                <RestorationControls />
              </div>
            </TabsContent>

            <TabsContent value="background" className="mt-0 pb-4">
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Background Settings</h3>
                <BackgroundControls />
              </div>
            </TabsContent>

            <TabsContent value="security" className="mt-0 pb-4">
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Security Options</h3>
                <SecurityControls />
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

export default function Workspace() {
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [actionsCollapsed, setActionsCollapsed] = useState(false);
  const { settings, currentImage } = useWorkspace();
  const { currentJob } = useJob();

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Navbar />

      <div className="border-b bg-card/50">
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-2" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <span className="text-xs font-semibold text-muted-foreground">Quick Actions</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setActionsCollapsed(!actionsCollapsed)}
            aria-label={actionsCollapsed ? "Show quick actions" : "Hide quick actions"}
          >
            {actionsCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
        {!actionsCollapsed && (
          <div className="px-4 pb-2">
            <ActionButtons compact />
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Mobile sidebar trigger */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="fixed top-20 right-4 z-50 lg:hidden gap-2 rounded-full shadow-elevated px-3"
            >
              <Menu className="h-5 w-5" />
              <span className="text-xs font-medium">Controls</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 p-0 overflow-hidden">
            <SidebarContent />
          </SheetContent>
        </Sheet>

        {/* Desktop sidebar */}
        <aside
          className={`
            hidden lg:flex flex-col border-r bg-card transition-all duration-300 overflow-hidden
            ${sidebarCollapsed ? 'w-0' : 'w-80'}
          `}
        >
          {!sidebarCollapsed && (
            <div className="flex-1 overflow-hidden">
              <SidebarContent />
            </div>
          )}

          {/* Collapse toggle */}
          <Button
            variant="ghost"
            size="icon"
            className={`
              absolute top-1/2 -translate-y-1/2 z-10 h-6 w-6 rounded-full border bg-background shadow-sm
              transition-all duration-300
              ${sidebarCollapsed ? 'left-2' : 'left-[304px]'}
            `}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </aside>

        {/* Main content area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden gap-2 lg:gap-0">
            {/* Image preview */}
            <div className="flex-1 min-h-[50vh] lg:min-h-0 overflow-auto order-1">
              <ImagePreview />
            </div>

            {/* Right panel - Job progress, metrics, and Export */}
            {(currentJob || currentImage || settings.enhancement.enabled || settings.background.enabled || settings.security.enabled) && (
              <aside className="w-full lg:w-72 border-t lg:border-t-0 lg:border-l bg-card flex flex-col overflow-hidden order-2 max-h-[40vh] lg:max-h-none">
                {/* Right Sidebar Header with Export Button */}
                <div className="p-4 border-b flex items-center justify-between bg-card z-10">
                  <h3 className="font-semibold text-sm">Status</h3>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="default" className="gap-2">
                        <Download className="h-4 w-4" />
                        Export
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <ExportSection />
                    </DialogContent>
                  </Dialog>
                </div>

                <div className="flex-1 overflow-auto">
                  <div className="p-4 space-y-4">
                    <JobProgress />
                    <ResultMetrics />
                  </div>
                </div>
              </aside>
            )}
          </div>
        </main>
      </div>

    </div>
  );
}
