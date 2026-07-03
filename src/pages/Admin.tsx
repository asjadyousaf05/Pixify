import { useState, useEffect, useMemo } from 'react';
import { Activity, Users, FileText, CheckCircle, AlertCircle, Clock, Search, MoreHorizontal, Shield, UserX, UserCheck } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { adminService } from '@/services/admin.service';
import { ModelInfo, SystemMetrics, AuditLog, User, UserRole } from '@/types';
import { format } from 'date-fns';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';

export default function Admin() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    const [modelsData, metricsData, logsData, usersData] = await Promise.all([
      adminService.getModelStatus(),
      adminService.getSystemMetrics(),
      adminService.getAuditLogs(),
      adminService.getUsers(),
    ]);
    setModels(modelsData);
    setMetrics(metricsData);
    setLogs(logsData);
    setUsers(usersData);
    setIsLoading(false);
  };

  const filteredUsers = useMemo(() => {
    if (!userSearchQuery.trim()) return users;
    return users.filter(u => 
      u.email.toLowerCase().includes(userSearchQuery.toLowerCase()) || 
      u.name.toLowerCase().includes(userSearchQuery.toLowerCase())
    );
  }, [users, userSearchQuery]);

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    const success = await adminService.updateUserRole(userId, newRole);
    if (success) {
      toast({ title: 'Role updated successfully', description: 'The user permissions have been modified.' });
      loadData();
    } else {
      toast({ title: 'Update failed', description: 'Could not change user role.', variant: 'destructive' });
    }
  };

  const handleStatusChange = async (userId: string, status: 'active' | 'disabled') => {
    const success = await adminService.updateUserStatus(userId, status);
    if (success) {
      toast({ title: 'Status updated successfully', description: `User account is now ${status}.` });
      loadData();
    } else {
      toast({ title: 'Update failed', description: 'Could not change user status.', variant: 'destructive' });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-success text-success-foreground';
      case 'offline': return 'bg-destructive text-destructive-foreground';
      case 'degraded': return 'bg-warning text-warning-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
          <p className="text-muted-foreground">Monitor system status and manage users.</p>
        </div>

        <Tabs defaultValue="models" className="space-y-6">
          <TabsList>
            <TabsTrigger value="models"><Activity className="h-4 w-4 mr-2" />Model Status</TabsTrigger>
            <TabsTrigger value="logs"><FileText className="h-4 w-4 mr-2" />Audit Logs</TabsTrigger>
            <TabsTrigger value="users"><Users className="h-4 w-4 mr-2" />Users</TabsTrigger>
          </TabsList>

          <TabsContent value="models" className="space-y-6">
            {/* Model Status Cards */}
            <div className="grid gap-4 md:grid-cols-3">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-6"><Skeleton className="h-20" /></CardContent></Card>
                ))
              ) : models.map((model) => (
                <Card key={model.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{model.name}</CardTitle>
                      <Badge className={getStatusColor(model.status)}>{model.status}</Badge>
                    </div>
                    <CardDescription>v{model.version}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Uptime</span>
                      <span className="font-medium">{model.uptime}%</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-muted-foreground">Last heartbeat</span>
                      <span className="text-xs">{format(model.lastHeartbeat, 'HH:mm:ss')}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* System Metrics */}
            {metrics && (
              <div className="grid gap-4 md:grid-cols-4">
                <Card><CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold">{metrics.queueLength}</div>
                  <div className="text-xs text-muted-foreground">Queue Length</div>
                </CardContent></Card>
                <Card><CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold">{metrics.avgProcessingTime.toFixed(1)}s</div>
                  <div className="text-xs text-muted-foreground">Avg Processing</div>
                </CardContent></Card>
                <Card><CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold">{metrics.errorRate.toFixed(1)}%</div>
                  <div className="text-xs text-muted-foreground">Error Rate</div>
                </CardContent></Card>
                <Card><CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold">{metrics.totalJobsToday}</div>
                  <div className="text-xs text-muted-foreground">Jobs Today</div>
                </CardContent></Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="logs">
            <Card>
              <CardHeader><CardTitle>Audit Logs</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.slice(0, 20).map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs">{format(log.timestamp, 'MMM d, HH:mm')}</TableCell>
                        <TableCell><Badge variant="outline">{log.actorEmail || log.actorId}</Badge></TableCell>
                        <TableCell><Badge variant="secondary">{log.action}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{log.details}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle>User Management</CardTitle>
                <div className="relative w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Search users..."
                    className="pl-8"
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{user.name}</TableCell>
                        <TableCell><Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge></TableCell>
                        <TableCell><Badge variant={user.status === 'active' ? 'outline' : 'destructive'}>{user.status}</Badge></TableCell>
                        <TableCell className="text-xs">{format(user.createdAt, 'MMM d, yyyy')}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleRoleChange(user.id, user.role === 'admin' ? 'user' : 'admin')}>
                                <Shield className="mr-2 h-4 w-4" />
                                {user.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                className={user.status === 'active' ? 'text-destructive focus:text-destructive' : 'text-success focus:text-success'}
                                onClick={() => handleStatusChange(user.id, user.status === 'active' ? 'disabled' : 'active')}
                              >
                                {user.status === 'active' ? (
                                  <><UserX className="mr-2 h-4 w-4" /> Disable Account</>
                                ) : (
                                  <><UserCheck className="mr-2 h-4 w-4" /> Enable Account</>
                                )}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
