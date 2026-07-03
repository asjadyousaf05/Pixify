import { Link, useLocation } from 'react-router-dom';
import { Moon, Sun, User, LogOut, Settings, Shield, ChevronDown } from 'lucide-react';
import { LogoMark } from '@/components/brand/LogoMark';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const location = useLocation();

  const isWorkspace = location.pathname.startsWith('/app') || 
                      location.pathname.startsWith('/vault') || 
                      location.pathname.startsWith('/admin');

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-destructive text-destructive-foreground';
      case 'user': return 'bg-primary text-primary-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary shadow-sm">
            <LogoMark className="h-5 w-5 text-white" />
          </div>
          <span className="font-semibold text-lg hidden sm:inline-block">
            Pixify
          </span>
        </Link>

        {/* Navigation Links - Only show in workspace */}
        {isWorkspace && isAuthenticated && (
          <nav className="hidden md:flex items-center gap-1">
            <Link to="/app">
              <Button 
                variant={location.pathname === '/app' ? 'secondary' : 'ghost'} 
                size="sm"
              >
                Workspace
              </Button>
            </Link>
            {user?.role !== 'guest' && (
              <Link to="/vault">
                <Button 
                  variant={location.pathname === '/vault' ? 'secondary' : 'ghost'} 
                  size="sm"
                >
                  Vault
                </Button>
              </Link>
            )}
            {user?.role === 'admin' && (
              <Link to="/admin">
                <Button 
                  variant={location.pathname === '/admin' ? 'secondary' : 'ghost'} 
                  size="sm"
                >
                  Admin
                </Button>
              </Link>
            )}
          </nav>
        )}

        {/* Right side actions */}
        <div className="flex items-center gap-2">
          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-9 w-9"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
            <span className="sr-only">Toggle theme</span>
          </Button>

          {/* User menu or auth buttons */}
          {isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2 px-2">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.avatarUrl} alt={user.name} />
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      {user.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden sm:flex flex-col items-start">
                    <span className="text-sm font-medium">{user.name}</span>
                    <Badge 
                      variant="secondary" 
                      className={`text-[10px] px-1.5 py-0 ${getRoleBadgeColor(user.role)}`}
                    >
                      {user.role.toUpperCase()}
                    </Badge>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span>{user.name}</span>
                    <span className="text-xs text-muted-foreground font-normal">
                      {user.email}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/app" className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    Workspace
                  </Link>
                </DropdownMenuItem>
                {user.role !== 'guest' && (
                  <DropdownMenuItem asChild>
                    <Link to="/vault" className="cursor-pointer">
                      <Settings className="mr-2 h-4 w-4" />
                      My Vault
                    </Link>
                  </DropdownMenuItem>
                )}
                {user.role === 'admin' && (
                  <DropdownMenuItem asChild>
                    <Link to="/admin" className="cursor-pointer">
                      <Shield className="mr-2 h-4 w-4" />
                      Admin Dashboard
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <Link to="/login">
                <Button variant="ghost" size="sm">
                  Login
                </Button>
              </Link>
              <Link to="/signup">
                <Button size="sm" className="gradient-primary">
                  Sign Up
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
