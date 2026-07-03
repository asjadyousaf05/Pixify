import { Navbar } from '@/components/layout/Navbar';
import { SignupForm } from '@/components/auth/AuthForms';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Signup() {
  const navigate = useNavigate();

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.12),transparent_45%),radial-gradient(circle_at_bottom,hsl(var(--accent)/0.2),transparent_50%)]">
      <Navbar />
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="relative w-full max-w-md">
          <div
            className="pointer-events-none absolute -inset-6 rounded-3xl bg-gradient-to-r from-primary/20 via-orange-300/10 to-primary/20 blur-2xl opacity-60"
            aria-hidden="true"
          />
          <div className="relative z-10">
            <Button variant="ghost" size="sm" className="mb-3 gap-2" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <div className="relative rounded-2xl border bg-card/95 backdrop-blur shadow-elevated">
              <SignupForm />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
