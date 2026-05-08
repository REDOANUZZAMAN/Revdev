"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@clerk/nextjs";
import { useRef, useEffect, useState } from "react";
import { 
  Code2, 
  Sparkles, 
  Zap, 
  GitBranch, 
  Terminal, 
  Braces,
  ArrowRight,
  Check,
  Star,
  Github,
  Play,
  Shield,
  Globe,
  Cpu,
  Layers,
  Rocket
} from "lucide-react";

// Particle effect component - subtle and elegant
const ParticleField = () => {
  const [particles, setParticles] = useState<Array<{ x: number; y: number; size: number; delay: number; duration: number }>>([]);
  
  useEffect(() => {
    const newParticles = Array.from({ length: 20 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 1,
      delay: Math.random() * 5,
      duration: Math.random() * 10 + 15
    }));
    setParticles(newParticles);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((particle, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: particle.size,
            height: particle.size,
            background: `radial-gradient(circle, rgba(139, 92, 246, 0.6) 0%, transparent 70%)`,
          }}
          animate={{
            y: [0, -30, 0],
            opacity: [0.2, 0.5, 0.2],
            scale: [1, 1.5, 1],
          }}
          transition={{
            duration: particle.duration,
            delay: particle.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
};

// Glowing orb component - more subtle
const GlowingOrb = ({ className, color }: { className: string; color: string }) => (
  <motion.div
    className={`absolute rounded-full blur-[100px] ${className}`}
    style={{ background: color }}
    animate={{
      scale: [1, 1.1, 1],
      opacity: [0.15, 0.25, 0.15],
    }}
    transition={{
      duration: 10,
      repeat: Infinity,
      ease: "easeInOut",
    }}
  />
);



// Code lines data for typing effect
const codeLines = [
  { text: "import { createAI } from '@revdev/ai';", color: "default" },
  { text: "import { deploy } from '@revdev/cloud';", color: "default" },
  { text: "", color: "empty" },
  { text: "const ai = createAI({ model: 'deepseek-v3' });", color: "default" },
  { text: "", color: "empty" },
  { text: "// ✨ AI: Generating optimized component...", color: "comment" },
  { text: "const App = await ai.generate('portfolio');", color: "highlight" },
  { text: "", color: "empty" },
  { text: "await deploy(App, { region: 'global' });", color: "default" },
  { text: "", color: "empty" },
  { text: "// 🚀 Deployed to https://portfolio.revdev.app", color: "comment" },
];

// Looping code typing animation component
const LoopingCodeEditor = () => {
  const [currentLine, setCurrentLine] = useState(0);
  const [currentChar, setCurrentChar] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pauseCounter, setPauseCounter] = useState(0);
  
  useEffect(() => {
    const typingSpeed = 30;
    const deleteSpeed = 15;
    const linePause = 200;
    const endPause = 3000;
    const deletePause = 1500;
    
    const timer = setInterval(() => {
      // Pause at the end before deleting
      if (pauseCounter > 0) {
        setPauseCounter(prev => prev - 50);
        return;
      }
      
      if (isDeleting) {
        // Delete all lines at once after pause
        if (lines.length > 0) {
          setLines([]);
          setCurrentLine(0);
          setCurrentChar(0);
          setIsDeleting(false);
        }
        return;
      }
      
      const line = codeLines[currentLine];
      if (!line) {
        // All lines typed, start pause then delete
        setPauseCounter(endPause);
        setIsDeleting(true);
        return;
      }
      
      if (currentChar < line.text.length) {
        // Still typing current line
        setCurrentChar(prev => prev + 1);
        setLines(prev => {
          const newLines = [...prev];
          newLines[currentLine] = line.text.slice(0, currentChar + 1);
          return newLines;
        });
      } else {
        // Line complete, move to next
        if (currentLine < codeLines.length - 1) {
          setPauseCounter(linePause);
          setCurrentLine(prev => prev + 1);
          setCurrentChar(0);
          setLines(prev => [...prev, ""]);
        } else {
          // All done, pause then delete
          setPauseCounter(deletePause);
          setIsDeleting(true);
        }
      }
    }, isDeleting ? deleteSpeed : typingSpeed);
    
    return () => clearInterval(timer);
  }, [currentLine, currentChar, lines, isDeleting, pauseCounter]);
  
  const renderLine = (text: string, index: number) => {
    const lineData = codeLines[index];
    const isCurrentLine = index === currentLine && !isDeleting;
    const isHighlight = lineData?.color === "highlight";
    const isComment = lineData?.color === "comment";
    
    // Syntax highlighting
    const highlightSyntax = (code: string) => {
      if (!code) return <span>&nbsp;</span>;
      if (isComment) return <span className="text-gray-500">{code}</span>;
      
      return code.split(/(\s+)/).map((part, i) => {
        if (["import", "from", "const", "await"].includes(part)) {
          return <span key={i} className="text-violet-400">{part}</span>;
        }
        if (part.startsWith("'") || part.startsWith('"')) {
          return <span key={i} className="text-emerald-400">{part}</span>;
        }
        if (part.includes("createAI") || part.includes("deploy") || part.includes("generate")) {
          return <span key={i} className="text-yellow-300">{part}</span>;
        }
        if (part === "ai" || part === "App") {
          return <span key={i} className="text-cyan-300">{part}</span>;
        }
        if (part.startsWith("{") || part.startsWith("}")) {
          return <span key={i} className="text-orange-300">{part}</span>;
        }
        return <span key={i}>{part}</span>;
      });
    };
    
    return (
      <div 
        key={index}
        className={`flex items-center min-h-[2rem] ${isHighlight ? 'bg-violet-500/10 -mx-10 px-10 py-1' : ''}`}
      >
        <span className="text-gray-600 w-12 select-none text-right pr-6 text-base">{index + 1}</span>
        <span className="flex-1 whitespace-pre">
          {highlightSyntax(text)}
        </span>
        {isCurrentLine && (
          <motion.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 0.6, repeat: Infinity }}
            className="w-3 h-7 bg-violet-400 rounded-sm"
          />
        )}
      </div>
    );
  };
  
  return (
    <div className="font-mono text-lg md:text-xl lg:text-2xl leading-relaxed">
      {lines.map((line, index) => renderLine(line, index))}
      {lines.length === 0 && (
        <div className="flex items-center min-h-[2rem]">
          <span className="text-gray-600 w-12 select-none text-right pr-6 text-base">1</span>
          <motion.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 0.6, repeat: Infinity }}
            className="w-3 h-7 bg-violet-400 rounded-sm"
          />
        </div>
      )}
    </div>
  );
};

const fadeInUp = {
  initial: { opacity: 0, y: 60 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] }
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1
    }
  }
};

const scaleIn = {
  initial: { opacity: 0, scale: 0.8 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] }
};

const features = [
  {
    icon: Sparkles,
    title: "AI-Powered Coding",
    description: "Get intelligent code suggestions and completions powered by advanced AI models.",
    gradient: "from-violet-500 to-purple-600"
  },
  {
    icon: Terminal,
    title: "Cloud IDE",
    description: "Full-featured development environment running entirely in your browser.",
    gradient: "from-cyan-500 to-blue-600"
  },
  {
    icon: GitBranch,
    title: "Version Control",
    description: "Built-in Git integration for seamless collaboration and code management.",
    gradient: "from-emerald-500 to-teal-600"
  },
  {
    icon: Zap,
    title: "Lightning Fast",
    description: "Instant file operations with WebContainer technology for near-native performance.",
    gradient: "from-amber-500 to-orange-600"
  },
  {
    icon: Shield,
    title: "Enterprise Security",
    description: "Bank-grade encryption and SOC 2 compliance to keep your code safe.",
    gradient: "from-rose-500 to-pink-600"
  },
  {
    icon: Globe,
    title: "Deploy Anywhere",
    description: "One-click deployment to any cloud provider or your own infrastructure.",
    gradient: "from-indigo-500 to-violet-600"
  }
];

const pricingPlans = [
  {
    name: "Starter",
    price: "Free",
    description: "Perfect for learning and small projects",
    features: ["5 Projects", "Basic AI Assistance", "Community Support", "1GB Storage"],
    highlighted: false,
    icon: Rocket
  },
  {
    name: "Pro",
    price: "$19",
    period: "/month",
    description: "For professional developers",
    features: ["Unlimited Projects", "Advanced AI Models", "Priority Support", "50GB Storage", "Custom Domains", "Team Collaboration"],
    highlighted: true,
    icon: Cpu
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For large teams and organizations",
    features: ["Everything in Pro", "Dedicated Support", "SSO & SAML", "Unlimited Storage", "SLA Guarantee", "On-premise Option"],
    highlighted: false,
    icon: Layers
  }
];

const testimonials = [
  {
    name: "Sarah Chen",
    role: "Senior Developer @ Stripe",
    content: "REVDEV has completely transformed how I code. The AI suggestions are incredibly accurate.",
    avatar: "SC"
  },
  {
    name: "Marcus Johnson",
    role: "CTO @ TechStart",
    content: "We moved our entire team to REVDEV. Productivity increased by 40% in the first month.",
    avatar: "MJ"
  },
  {
    name: "Emily Rodriguez",
    role: "Freelance Developer",
    content: "The cloud IDE means I can code from anywhere. It's like having my dev environment in my pocket.",
    avatar: "ER"
  }
];

export default function LandingPage() {
  const { isSignedIn } = useAuth();
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"]
  });
  
  // Subtle parallax - content stays visible
  const heroOpacity = useTransform(scrollYProgress, [0, 1], [1, 1]); // Keep fully visible
  const heroScale = useTransform(scrollYProgress, [0, 1], [1, 1]); // No scale change
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 0]); // No vertical movement
  
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-hidden">
      {/* Premium Animated Background */}
      <div className="fixed inset-0 z-0">
        {/* Base gradient */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-900/20 via-[#0a0a0f] to-[#0a0a0f]" />
        
        {/* Mesh gradient overlay */}
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: `
            radial-gradient(at 27% 37%, hsla(215, 98%, 61%, 0.15) 0px, transparent 50%),
            radial-gradient(at 97% 21%, hsla(275, 98%, 61%, 0.15) 0px, transparent 50%),
            radial-gradient(at 52% 99%, hsla(189, 98%, 61%, 0.15) 0px, transparent 50%),
            radial-gradient(at 10% 29%, hsla(256, 96%, 67%, 0.15) 0px, transparent 50%),
            radial-gradient(at 97% 96%, hsla(200, 98%, 61%, 0.15) 0px, transparent 50%),
            radial-gradient(at 33% 50%, hsla(222, 67%, 73%, 0.15) 0px, transparent 50%),
            radial-gradient(at 79% 53%, hsla(330, 96%, 61%, 0.15) 0px, transparent 50%)
          `
        }} />
        
        {/* Animated orbs - subtle background glow */}
        <GlowingOrb className="w-[800px] h-[800px] top-[-300px] left-[-200px]" color="rgba(139, 92, 246, 0.08)" />
        <GlowingOrb className="w-[600px] h-[600px] bottom-[-200px] right-[-150px]" color="rgba(6, 182, 212, 0.08)" />
        
        {/* Particle field */}
        <ParticleField />
        
        {/* Noise texture overlay */}
        <div className="absolute inset-0 opacity-[0.015]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`
        }} />
      </div>

      {/* Premium Grid Pattern */}
      <div 
        className="fixed inset-0 z-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
          `,
          backgroundSize: '100px 100px'
        }}
      />

      {/* Navigation */}
      <motion.nav 
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        className="fixed top-0 left-0 right-0 z-50 px-6 py-4 lg:px-12"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between backdrop-blur-xl bg-white/[0.02] border border-white/[0.05] rounded-2xl px-6 py-3">
          <div className="flex items-center gap-3">
            <motion.div
              whileHover={{ scale: 1.05 }}
              className="relative"
            >
              <div className="relative w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center overflow-hidden">
                <Image src="/logo.svg" alt="REVDEV" width={36} height={36} className="object-contain" />
              </div>
            </motion.div>
            <span className="text-2xl font-bold bg-gradient-to-r from-white via-violet-200 to-cyan-200 bg-clip-text text-transparent">
              REVDEV
            </span>
          </div>
          
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-gray-400 hover:text-white transition-all duration-300 text-sm font-medium">Features</a>
            <a href="#testimonials" className="text-gray-400 hover:text-white transition-all duration-300 text-sm font-medium">Testimonials</a>
            <a href="#pricing" className="text-gray-400 hover:text-white transition-all duration-300 text-sm font-medium">Pricing</a>
            <Link href="/docs" className="text-gray-400 hover:text-white transition-all duration-300 text-sm font-medium">Docs</Link>
          </div>

          <div className="flex items-center gap-3">
            {isSignedIn ? (
              <Link
                href="/projects"
                className="group relative px-5 py-2.5 rounded-xl font-medium text-sm overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-violet-600 to-cyan-600 transition-transform group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-r from-violet-500 to-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="relative">Dashboard</span>
              </Link>
            ) : (
              <>
                <Link 
                  href="/sign-in"
                  className="text-gray-400 hover:text-white transition-all duration-300 text-sm font-medium px-4 py-2"
                >
                  Sign In
                </Link>
                <Link
                  href="/sign-up"
                  className="group relative px-5 py-2.5 rounded-xl font-medium text-sm overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-violet-600 to-cyan-600 transition-transform group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-r from-violet-500 to-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <span className="relative flex items-center gap-2">
                    Get Started
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </Link>
              </>
            )}
          </div>
        </div>
      </motion.nav>

      {/* Hero Section */}
      <section 
        ref={heroRef}
        className="relative z-10 px-6 pt-32 pb-20 lg:px-12 lg:pt-44 min-h-screen flex flex-col justify-center"
      >
        <div className="max-w-7xl mx-auto text-center">
          {/* Announcement Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-gradient-to-r from-violet-500/10 to-cyan-500/10 border border-violet-500/20 mb-8 backdrop-blur-sm"
          >
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
            </span>
            <span className="text-sm text-gray-300 font-medium">Introducing REVDEV 2.0 — Now with Multiple AI Providers</span>
            <ArrowRight className="w-4 h-4 text-violet-400" />
          </motion.div>

          {/* Main Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="text-5xl md:text-7xl lg:text-8xl font-bold mb-8 leading-[0.95] tracking-tight"
          >
            <span className="block bg-gradient-to-b from-white via-white to-white/40 bg-clip-text text-transparent">
              The Future of
            </span>
            <span className="block mt-2 bg-gradient-to-r from-violet-400 via-fuchsia-400 to-cyan-400 bg-clip-text text-transparent animate-gradient bg-[length:200%_auto]">
              Code Creation
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.5 }}
            className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-12 leading-relaxed"
          >
            Experience the next evolution of development. AI-powered intelligence, 
            cloud-native performance, and beautiful design — all in one platform.
          </motion.p>

          

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.7 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link
              href="/sign-up"
              className="group relative px-8 py-4 rounded-2xl font-semibold text-lg overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-600 transition-all duration-500 group-hover:scale-105" />
              <div className="absolute inset-[1px] bg-[#0a0a0f] rounded-2xl opacity-0 group-hover:opacity-90 transition-opacity" />
              <div className="absolute inset-0 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-600 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="relative flex items-center gap-2">
                <Play className="w-5 h-5" />
                Start Building Free
              </span>
            </Link>
            <a
              href="#features"
              className="group px-8 py-4 rounded-2xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] hover:border-white/20 transition-all duration-300 font-semibold text-lg backdrop-blur-sm"
            >
              <span className="flex items-center gap-2">
                Explore Features
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </span>
            </a>
          </motion.div>

          {/* Stats Row */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.9 }}
            className="flex flex-wrap items-center justify-center gap-8 md:gap-16 mt-20"
          >
            {[
              { value: "50K+", label: "Active Developers", color: "from-violet-400 to-purple-400" },
              { value: "2M+", label: "Lines Generated", color: "from-cyan-400 to-blue-400" },
              { value: "99.99%", label: "Uptime SLA", color: "from-emerald-400 to-teal-400" },
              { value: "4.9", label: "Developer Rating", icon: Star, color: "from-amber-400 to-orange-400" }
            ].map((stat, index) => (
              <motion.div 
                key={index} 
                className="text-center"
                whileHover={{ scale: 1.05 }}
                transition={{ type: "spring", stiffness: 400 }}
              >
                <div className={`text-3xl md:text-4xl font-bold bg-gradient-to-r ${stat.color} bg-clip-text text-transparent flex items-center justify-center gap-1`}>
                  {stat.value}
                  {stat.icon && <stat.icon className="w-6 h-6 text-amber-400 fill-amber-400" />}
                </div>
                <div className="text-gray-500 text-sm mt-1 font-medium">{stat.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Premium Code Editor Preview - Full Width */}
        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, delay: 1 }}
          className="w-full max-w-[90rem] mx-auto mt-24 px-4"
        >
          <div className="relative group">
            {/* Glow effect */}
            <div className="absolute -inset-4 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-600 rounded-[2.5rem] blur-[60px] opacity-20 group-hover:opacity-35 transition-opacity duration-700" />
            
            <div className="relative rounded-[2rem] overflow-hidden border border-white/10 bg-[#0d0d12]/95 backdrop-blur-xl shadow-2xl">
              {/* Editor Header */}
              <div className="flex items-center justify-between px-10 py-5 bg-white/[0.02] border-b border-white/5">
                <div className="flex items-center gap-6">
                  <div className="flex gap-3">
                    <div className="w-4 h-4 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors cursor-pointer" />
                    <div className="w-4 h-4 rounded-full bg-yellow-500/80 hover:bg-yellow-500 transition-colors cursor-pointer" />
                    <div className="w-4 h-4 rounded-full bg-green-500/80 hover:bg-green-500 transition-colors cursor-pointer" />
                  </div>
                  <div className="h-6 w-px bg-white/10" />
                  <div className="flex items-center gap-3 px-4 py-1.5 rounded-lg bg-white/5">
                    <Code2 className="w-4 h-4 text-cyan-400" />
                    <span className="text-sm text-gray-300 font-mono">main.tsx</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Saved</span>
                  </div>
                  <span className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500/20 to-cyan-500/20 border border-violet-500/30 text-violet-300 text-sm font-medium flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    AI Active
                  </span>
                </div>
              </div>
              
              {/* Code Content - Looping Typing Effect */}
              <div className="p-10 md:p-12 min-h-[450px]">
                <LoopingCodeEditor />
              </div>

              {/* Bottom toolbar */}
              <div className="flex items-center justify-between px-10 py-4 bg-white/[0.02] border-t border-white/5 text-sm text-gray-400">
                <div className="flex items-center gap-8">
                  <div className="flex items-center gap-2">
                    <Braces className="w-4 h-4" />
                    <span>TypeScript React</span>
                  </div>
                  <span>UTF-8</span>
                  <span>LF</span>
                </div>
                <div className="flex items-center gap-4">
                  <span>Ln 7, Col 42</span>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-emerald-400">Connected</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative z-10 px-6 py-32 lg:px-12">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-20"
          >
            <motion.span 
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="inline-block px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-sm font-medium mb-6"
            >
              Features
            </motion.span>
            <h2 className="text-4xl md:text-6xl font-bold mb-6">
              <span className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
                Everything you need to
              </span>
              <br />
              <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-cyan-400 bg-clip-text text-transparent">
                build amazing software
              </span>
            </h2>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">
              A complete development environment with AI at its core, designed for the modern developer.
            </p>
          </motion.div>

          <motion.div
            variants={staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {features.map((feature, index) => (
              <motion.div
                key={index}
                variants={fadeInUp}
                whileHover={{ y: -8, scale: 1.02 }}
                transition={{ type: "spring", stiffness: 400 }}
                className="group relative p-8 rounded-3xl bg-gradient-to-br from-white/[0.05] to-transparent border border-white/[0.08] hover:border-white/20 transition-all duration-500 overflow-hidden"
              >
                {/* Gradient glow on hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-500`} />
                
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.gradient} p-[1px] mb-6`}>
                  <div className="w-full h-full rounded-2xl bg-[#0a0a0f] flex items-center justify-center group-hover:bg-transparent transition-colors duration-300">
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                </div>
                <h3 className="text-xl font-semibold mb-3 text-white">{feature.title}</h3>
                <p className="text-gray-400 leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="relative z-10 px-6 py-32 lg:px-12">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
          >
            <motion.span 
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="inline-block px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-sm font-medium mb-6"
            >
              Testimonials
            </motion.span>
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              <span className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
                Loved by developers
              </span>
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="relative p-8 rounded-3xl bg-gradient-to-br from-white/[0.05] to-transparent border border-white/[0.08] backdrop-blur-sm"
              >
                <div className="flex items-center gap-1 mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-gray-300 mb-6 leading-relaxed">&ldquo;{testimonial.content}&rdquo;</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-sm font-semibold">
                    {testimonial.avatar}
                  </div>
                  <div>
                    <div className="font-medium text-white">{testimonial.name}</div>
                    <div className="text-sm text-gray-500">{testimonial.role}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="relative z-10 px-6 py-32 lg:px-12">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
          >
            <motion.span 
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="inline-block px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium mb-6"
            >
              Pricing
            </motion.span>
            <h2 className="text-4xl md:text-6xl font-bold mb-6">
              <span className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
                Simple, transparent
              </span>
              <br />
              <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                pricing
              </span>
            </h2>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">
              Start free, upgrade when you&apos;re ready. No hidden fees.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {pricingPlans.map((plan, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                whileHover={{ y: -8 }}
                className={`relative p-8 rounded-3xl border transition-all duration-500 ${
                  plan.highlighted 
                    ? 'bg-gradient-to-br from-violet-500/10 via-fuchsia-500/10 to-cyan-500/10 border-violet-500/30' 
                    : 'bg-white/[0.02] border-white/[0.08] hover:border-white/20'
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-gradient-to-r from-violet-600 to-cyan-600 text-sm font-medium">
                    Most Popular
                  </div>
                )}
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${plan.highlighted ? 'from-violet-500 to-cyan-500' : 'from-gray-700 to-gray-800'} flex items-center justify-center mb-6`}>
                  <plan.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  {plan.period && <span className="text-gray-400">{plan.period}</span>}
                </div>
                <p className="text-gray-400 mb-6">{plan.description}</p>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-3 text-gray-300">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center ${plan.highlighted ? 'bg-violet-500/20' : 'bg-white/10'}`}>
                        <Check className={`w-3 h-3 ${plan.highlighted ? 'text-violet-400' : 'text-gray-400'}`} />
                      </div>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/sign-up"
                  className={`block w-full py-3.5 rounded-xl text-center font-medium transition-all duration-300 ${
                    plan.highlighted
                      ? 'bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 shadow-lg shadow-violet-500/25'
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  Get Started
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 px-6 py-32 lg:px-12">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-5xl mx-auto relative"
        >
          {/* Background glow */}
          <div className="absolute inset-0 bg-gradient-to-r from-violet-600/20 via-fuchsia-600/20 to-cyan-600/20 rounded-[3rem] blur-3xl" />
          
          <div className="relative text-center p-12 md:p-16 rounded-[2.5rem] bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 backdrop-blur-xl overflow-hidden">
            {/* Decorative elements */}
            <div className="absolute top-0 left-0 w-40 h-40 bg-violet-500/20 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-40 h-40 bg-cyan-500/20 rounded-full blur-3xl" />
            
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
            >
              <h2 className="text-4xl md:text-6xl font-bold mb-6 relative">
                Ready to <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-cyan-400 bg-clip-text text-transparent">revolutionize</span>
                <br />
                your development?
              </h2>
              <p className="text-lg text-gray-400 mb-10 max-w-2xl mx-auto">
                Join over 50,000 developers already building the future with REVDEV. 
                Start free, no credit card required.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  href="/sign-up"
                  className="group relative px-8 py-4 rounded-2xl font-semibold text-lg overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-600" />
                  <div className="absolute inset-0 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <span className="relative flex items-center gap-2">
                    Start Building Now
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </span>
                </Link>
                <a href="#" className="text-gray-400 hover:text-white transition-colors font-medium flex items-center gap-2">
                  <Github className="w-5 h-5" />
                  Star on GitHub
                </a>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-6 py-16 lg:px-12 border-t border-white/[0.05]">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            <div className="col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-violet-500 to-cyan-500 rounded-xl blur-lg opacity-50" />
                  <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
                    <Code2 className="w-5 h-5 text-white" />
                  </div>
                </div>
                <span className="text-xl font-bold bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                  REVDEV
                </span>
              </div>
              <p className="text-gray-500 text-sm max-w-xs mb-4">
                The next-generation cloud IDE with AI superpowers. Build faster, smarter, anywhere.
              </p>
              <div className="flex items-center gap-3">
                <a href="#" className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
                  <Github className="w-4 h-4 text-gray-400" />
                </a>
              </div>
            </div>
            
            <div>
              <h4 className="font-semibold text-white mb-4">Product</h4>
              <ul className="space-y-2.5 text-sm text-gray-500">
                <li><a href="#" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Changelog</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Roadmap</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold text-white mb-4">Resources</h4>
              <ul className="space-y-2.5 text-sm text-gray-500">
                <li><a href="#" className="hover:text-white transition-colors">Documentation</a></li>
                <li><a href="#" className="hover:text-white transition-colors">API Reference</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Community</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold text-white mb-4">Legal</h4>
              <ul className="space-y-2.5 text-sm text-gray-500">
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Terms of Service</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Cookie Policy</a></li>
              </ul>
            </div>
          </div>
          
          <div className="pt-8 border-t border-white/[0.05] flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-gray-500 text-sm">
              © 2026 REVDEV. All rights reserved.
            </p>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              All systems operational
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Helper component for code lines
const CodeLine = ({ num, content, highlight }: { num: number; content: React.ReactNode; highlight?: boolean }) => (
  <div className={`flex items-center ${highlight ? 'bg-violet-500/10 -mx-6 px-6 py-1' : ''}`}>
    <span className="text-gray-600 w-8 select-none">{num}</span>
    <span className="flex-1">{content}</span>
    {highlight && (
      <motion.span
        animate={{ opacity: [1, 0, 1] }}
        transition={{ duration: 1, repeat: Infinity }}
        className="w-2 h-5 bg-violet-400 ml-1"
      />
    )}
  </div>
);
