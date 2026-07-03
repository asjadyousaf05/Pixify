import { Link } from 'react-router-dom';
import { Github, Twitter, Linkedin } from 'lucide-react';
import { LogoMark } from '@/components/brand/LogoMark';

const teamMembers = [
  { name: 'Muhammad Waleed', role: 'Creater' },
  { name: 'Syed Muhammad Zain', role: 'Creater' },
  { name: 'Hussain Minhas', role: 'Creater' },
];

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t bg-muted/30">
      <div className="container px-4 py-12">
        {/* Main footer content */}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-4">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary shadow-sm">
                <LogoMark className="h-5 w-5 text-white" />
              </div>
              <span className="font-semibold text-lg">Pixify</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              AI-powered image enhancement and security platform. 
              Enhance, remove backgrounds, and secure your images with 
              cutting-edge technology.
            </p>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h4 className="font-semibold">Quick Links</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link to="/app" className="hover:text-foreground transition-colors">
                  Workspace
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-foreground transition-colors">
                  Login
                </Link>
              </li>
              <li>
                <Link to="/signup" className="hover:text-foreground transition-colors">
                  Sign Up
                </Link>
              </li>
            </ul>
          </div>

          {/* Technology */}
          <div className="space-y-4">
            <h4 className="font-semibold">Technology</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>CNN + GAN Enhancement</li>
              <li>U-Net Segmentation</li>
              <li>AES-256 Encryption</li>
              <li>React + TypeScript</li>
            </ul>
          </div>

          {/* Creater */}
          <div className="space-y-4">
            <h4 className="font-semibold">Creater</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {teamMembers.map((member, index) => (
                <li key={index}>
                  {member.name} - {member.role}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t">
          <div className="flex justify-center">
            <div className="flex items-center gap-4">
              <a 
                href="#" 
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="GitHub"
              >
                <Github className="h-5 w-5" />
              </a>
              <a 
                href="#" 
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Twitter"
              >
                <Twitter className="h-5 w-5" />
              </a>
              <a 
                href="#" 
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="LinkedIn"
              >
                <Linkedin className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
          <p>
            © {currentYear} Pixify - Final Year Project. All rights reserved.
          </p>
          <p className="mt-1">
            Built with React, TypeScript, and AI-powered processing.
          </p>
        </div>
      </div>
    </footer>
  );
}
