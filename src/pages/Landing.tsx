import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { Hero, Features, HowItWorks, BeforeAfter } from '@/components/landing/LandingContent';

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <BeforeAfter />
        <Features />
        <HowItWorks />
      </main>
      <Footer />
    </div>
  );
}
