import { Link } from 'react-router-dom';
import { 
  Sparkles, 
  Eraser, 
  Lock, 
  Upload, 
  Settings, 
  Download,
  ArrowRight,
  Zap,
  Shield,
  ImageIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import howItWorksVideo from '@/assets/media/example.mp4';

const features = [
  {
    icon: Sparkles,
    title: 'AI Enhancement',
    subtitle: 'CNN + GAN',
    description: 'Upscale, denoise, and deblur images using state-of-the-art deep learning models.',
    color: 'text-primary',
    bgColor: 'bg-primary/10',
  },
  {
    icon: Eraser,
    title: 'Background Removal',
    subtitle: 'U-Net Segmentation',
    description: 'Precisely remove or replace backgrounds with AI-powered segmentation.',
    color: 'text-success',
    bgColor: 'bg-success/10',
  },
  {
    icon: Lock,
    title: 'Security',
    subtitle: 'AES-256 Encryption',
    description: 'Encrypt your processed images and generate secure, expiring share links.',
    color: 'text-info',
    bgColor: 'bg-info/10',
  },
];

const steps = [
  {
    icon: Upload,
    title: 'Upload',
    description: 'Drag and drop your image or browse to select a file.',
  },
  {
    icon: Settings,
    title: 'Configure',
    description: 'Choose enhancement, background, and security options.',
  },
  {
    icon: Download,
    title: 'Download',
    description: 'Get your processed image or share it securely.',
  },
];

const comparisons = [
  {
    title: 'Portrait Enhancement',
    description: 'Cleaner tones, sharper detail, and balanced lighting.',
    image: '/image_before_after.webp',
  },
  {
    title: 'Product Cleanup',
    description: 'Crisp edges and cleaner backgrounds for catalogs.',
    image: '/image_before_after2.webp',
  },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 gradient-hero" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.15),transparent_50%)]" />
      
      <div className="container relative px-4 py-20 md:py-32">
        <div className="mx-auto max-w-4xl text-center">
          {/* Badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-background/80 backdrop-blur px-4 py-1.5 text-sm">
            <Zap className="h-4 w-4 text-primary" />
            <span>Pixify Image Processing</span>
          </div>

          {/* Main headline */}
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl text-balance">
            Enhance. Remove Background.{' '}
            <span className="bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">
              Secure Your Images.
            </span>
          </h1>

          {/* Subheadline */}
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
            Transform your images with cutting-edge AI technology. Upscale, 
            remove backgrounds, and encrypt your files—all in one powerful platform.
          </p>

          {/* CTA buttons */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/app">
              <Button size="lg" className="gradient-primary shadow-glow h-12 px-8 text-base">
                Start Processing
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link to="/login">
              <Button variant="outline" size="lg" className="h-12 px-8 text-base">
                Login
              </Button>
            </Link>
          </div>

          {/* Demo preview */}
          <div className="mt-16 relative">
            <div className="absolute -inset-4 bg-gradient-to-r from-primary/20 via-purple-500/20 to-primary/20 rounded-2xl blur-2xl" />
            <div className="relative rounded-xl border bg-card shadow-elevated overflow-hidden">
              <div className="flex items-center gap-2 border-b px-4 py-3 bg-muted/50">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-red-500" />
                  <div className="h-3 w-3 rounded-full bg-yellow-500" />
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                </div>
                <span className="text-xs text-muted-foreground ml-2">Pixify Workspace</span>
              </div>
              <div className="aspect-video bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                <div className="flex items-center gap-8">
                  <div className="text-center">
                    <div className="w-32 h-24 rounded-lg bg-muted-foreground/10 flex items-center justify-center mb-2">
                      <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                    <span className="text-xs text-muted-foreground">Original</span>
                  </div>
                  <ArrowRight className="h-6 w-6 text-primary animate-pulse" />
                  <div className="text-center">
                    <div className="w-32 h-24 rounded-lg bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center mb-2 border-2 border-primary/50">
                      <Sparkles className="h-8 w-8 text-primary" />
                    </div>
                    <span className="text-xs text-muted-foreground">Enhanced</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <section className="container px-4 py-20">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold mb-4">Powerful AI Features</h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Our platform combines multiple AI models to provide comprehensive image processing capabilities.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {features.map((feature, index) => (
          <Card key={index} className="relative overflow-hidden group hover:shadow-elevated transition-shadow">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-primary/5 to-transparent" />
            <CardHeader>
              <div className={`w-12 h-12 rounded-lg ${feature.bgColor} flex items-center justify-center mb-4`}>
                <feature.icon className={`h-6 w-6 ${feature.color}`} />
              </div>
              <CardTitle className="flex items-center gap-2">
                {feature.title}
              </CardTitle>
              <CardDescription className="text-xs uppercase tracking-wider text-primary font-medium">
                {feature.subtitle}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                {feature.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function BeforeAfter() {
  return (
    <section className="container px-4 py-20">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold mb-4">See the Difference</h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Before-and-after results build trust fast. Here are a couple of typical transformations.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {comparisons.map((item) => (
          <Card key={item.title} className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-lg">{item.title}</CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="relative rounded-lg overflow-hidden border bg-muted/40 aspect-[4/3]">
                  <img
                    src={item.image}
                    alt={`${item.title} before`}
                    className="h-full w-[200%] max-w-none object-cover translate-x-0"
                  />
                  <span className="absolute top-2 left-2 text-[10px] font-semibold uppercase tracking-wide bg-background/80 px-2 py-1 rounded-full border">
                    Before
                  </span>
                </div>
                <div className="relative rounded-lg overflow-hidden border bg-muted/40 aspect-[4/3]">
                  <img
                    src={item.image}
                    alt={`${item.title} after`}
                    className="h-full w-[200%] max-w-none object-cover -translate-x-1/2"
                  />
                  <span className="absolute top-2 left-2 text-[10px] font-semibold uppercase tracking-wide bg-background/80 px-2 py-1 rounded-full border">
                    After
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

    </section>
  );
}

export function HowItWorks() {
  return (
    <section className="container px-4 py-20 border-t">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold mb-4">How It Works</h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          A quick walkthrough of the flow. Upload, configure, and download in minutes.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2 items-start">
        <div className="relative rounded-2xl border bg-card shadow-elevated overflow-hidden">
          <div className="absolute -inset-8 bg-gradient-to-r from-primary/15 via-purple-500/10 to-primary/15 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-2 border-b px-4 py-3 bg-muted/50">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <div className="h-3 w-3 rounded-full bg-yellow-500" />
                <div className="h-3 w-3 rounded-full bg-green-500" />
              </div>
              <span className="text-xs text-muted-foreground ml-2">Workspace Walkthrough</span>
            </div>
            <div className="aspect-video bg-gradient-to-br from-muted to-muted/50">
              <video
                className="h-full w-full object-cover"
                src={howItWorksVideo}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          {steps.map((step, index) => (
            <Card key={index} className="border bg-card">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/10 to-purple-500/10 flex items-center justify-center">
                    <step.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{step.title}</CardTitle>
                    <CardDescription className="text-xs uppercase tracking-wider text-primary font-medium">
                      Step {index + 1}
                    </CardDescription>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">0{index + 1}</span>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="text-center mt-12">
        <Link to="/app">
          <Button size="lg" className="gradient-primary">
            Try It Now
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </Link>
      </div>
    </section>
  );
}
