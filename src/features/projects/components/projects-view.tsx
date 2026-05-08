"use client";

import { SparkleIcon, Home, Plus, FolderGit2, Sparkles, Command } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

import { ProjectsList } from "./projects-list";
import { ProjectsCommandDialog } from "./projects-command-dialog";
import { ImportGithubDialog } from "./import-github-dialog";
import { NewProjectDialog } from "./new-project-dialog";

// Using system-loaded Google Fonts via <link> in layout; apply via CSS class

export const ProjectsView = () => {
  const [commandDialogOpen, setCommandDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "k") {
          e.preventDefault();
          setCommandDialogOpen(true);
        }
        if (e.key === "i") {
          e.preventDefault();
          setImportDialogOpen(true);
        }
        if (e.key === "j") {
          e.preventDefault();
          setNewProjectDialogOpen(true);
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);


  return (
    <>
      <ProjectsCommandDialog
        open={commandDialogOpen}
        onOpenChange={setCommandDialogOpen}
      />
      <ImportGithubDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
      />
      <NewProjectDialog
        open={newProjectDialogOpen}
        onOpenChange={setNewProjectDialogOpen}
      />
      <div className="min-h-screen bg-black relative overflow-hidden">
        {/* Animated Background */}
        <div className="fixed inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-black to-cyan-950/20" />
          <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-violet-600/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-1/4 w-[500px] h-[500px] bg-cyan-600/10 rounded-full blur-3xl" />
        </div>
        
        {/* Grid Pattern */}
        <div 
          className="fixed inset-0 z-0 opacity-20"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
            backgroundSize: '60px 60px'
          }}
        />

        {/* Top Navigation */}
        <nav className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/5 backdrop-blur-sm">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Home className="size-4 text-white" />
            </div>
            <span className="text-sm text-gray-400 group-hover:text-white transition-colors hidden sm:inline">Home</span>
          </Link>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCommandDialogOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all text-sm"
            >
              <Command className="size-3" />
              <span className="hidden sm:inline">Search projects</span>
              <Kbd className="bg-white/10 border-white/20 text-xs">⌘K</Kbd>
            </button>
            <UserButton afterSignOutUrl="/" />
          </div>
        </nav>

        {/* Main Content */}
        <div className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-65px)] p-6 md:p-12">
          <div className="w-full max-w-lg mx-auto flex flex-col gap-8 items-center">

            {/* Logo & Title */}
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-violet-500 to-cyan-500 blur-2xl opacity-30" />
                <img src="/logo.svg" alt="REVDEV" className="relative size-16 md:size-20" />
              </div>
              <div>
                <h1 className={cn(
                  "text-4xl md:text-5xl font-bold bg-gradient-to-r from-violet-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent",
                  "font-poppins",
                )}>
                  REVDEV
                </h1>
                <p className="text-gray-500 mt-2 text-sm">Your AI-powered development workspace</p>
              </div>
            </div>

            {/* Action Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
              <button
                onClick={() => setNewProjectDialogOpen(true)}
                className="group relative p-6 rounded-2xl bg-gradient-to-br from-violet-600/20 to-violet-600/5 border border-violet-500/20 hover:border-violet-500/40 transition-all duration-300 text-left overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-violet-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Sparkles className="size-6 text-white" />
                    </div>
                    <Kbd className="bg-violet-500/20 border-violet-500/30 text-violet-300">⌘J</Kbd>
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-1">New Project</h3>
                  <p className="text-sm text-gray-400">Create with AI assistance</p>
                </div>
              </button>

              <button
                onClick={() => setImportDialogOpen(true)}
                className="group relative p-6 rounded-2xl bg-gradient-to-br from-cyan-600/20 to-cyan-600/5 border border-cyan-500/20 hover:border-cyan-500/40 transition-all duration-300 text-left overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <FaGithub className="size-6 text-white" />
                    </div>
                    <Kbd className="bg-cyan-500/20 border-cyan-500/30 text-cyan-300">⌘I</Kbd>
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-1">Import from GitHub</h3>
                  <p className="text-sm text-gray-400">Clone an existing repository</p>
                </div>
              </button>
            </div>

            {/* Projects List */}
            <div className="w-full">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Recent Projects</h2>
              </div>
              <div className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm overflow-hidden">
                <ProjectsList onViewAll={() => setCommandDialogOpen(true)} />
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
};
