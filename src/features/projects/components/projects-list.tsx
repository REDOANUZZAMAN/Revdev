"use client";

import Link from "next/link";
import { useState } from "react";
import { FaGithub } from "react-icons/fa";
import { formatDistanceToNow } from "date-fns";
import { AlertCircleIcon, ArrowRightIcon, GlobeIcon, Loader2Icon, FolderOpen, Trash2Icon } from "lucide-react";

import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Doc, Id } from "../../../../convex/_generated/dataModel";

import { useProjectsPartial, useDeleteProject } from "../hooks/use-projects";

const formatTimestamp = (timestamp: number) => {
  return formatDistanceToNow(new Date(timestamp), { 
    addSuffix: true
  });
};

const getProjectIcon = (project: Doc<"projects">) => {
  if (project.importStatus === "completed") {
    return <FaGithub className="size-4 text-cyan-400" />
  }

  if (project.importStatus === "failed") {
    return <AlertCircleIcon className="size-4 text-red-400" />;
  }

  if (project.importStatus === "importing") {
    return (
      <Loader2Icon className="size-4 text-violet-400 animate-spin" />
    );
  }

  return <GlobeIcon className="size-4 text-violet-400" />;
}

interface ProjectsListProps {
  onViewAll: () => void;
}

const ContinueCard = ({ 
  data
}: {
  data: Doc<"projects">;
}) => {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">
        Last updated
      </span>
      <Button
        variant="outline"
        asChild
        className="h-auto items-start justify-start p-4 bg-background border rounded-none flex flex-col gap-2"
      >
        <Link href={`/projects/${data._id}`} className="group">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              {getProjectIcon(data)}
              <span className="font-medium truncate">
                {data.name}
              </span>
            </div>
            <ArrowRightIcon className="size-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </div>
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(data.updatedAt)}
          </span>
        </Link>
      </Button>
    </div>
  )
};

const ProjectItem = ({ 
  data,
  onDelete,
}: {
  data: Doc<"projects">;
  onDelete: (id: Id<"projects">) => void;
}) => {
  return (
    <div className="group flex items-center justify-between w-full p-4 hover:bg-white/5 transition-all border-b border-white/5 last:border-0">
      <Link 
        href={`/projects/${data._id}`}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors shrink-0">
          {getProjectIcon(data)}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="font-medium text-white group-hover:text-violet-300 transition-colors truncate">{data.name}</span>
          <span className="text-xs text-gray-500">
            {formatTimestamp(data.updatedAt)}
          </span>
        </div>
      </Link>
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(data._id);
          }}
          className="p-2 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-all opacity-0 group-hover:opacity-100"
          title="Delete project"
        >
          <Trash2Icon className="size-4" />
        </button>
        <Link href={`/projects/${data._id}`}>
          <ArrowRightIcon className="size-4 text-gray-600 group-hover:text-violet-400 group-hover:translate-x-1 transition-all" />
        </Link>
      </div>
    </div>
  );
};

export const ProjectsList = ({ 
  onViewAll
}: ProjectsListProps) => {
  const projects = useProjectsPartial(6);
  const deleteProject = useDeleteProject();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Id<"projects"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");

  const handleDeleteClick = (id: Id<"projects">) => {
    setProjectToDelete(id);
    setConfirmationText("");
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    
    setIsDeleting(true);
    try {
      await deleteProject({ id: projectToDelete });
    } catch (error) {
      console.error("Failed to delete project:", error);
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setProjectToDelete(null);
      setConfirmationText("");
    }
  };

  const projectName = projects?.find(p => p._id === projectToDelete)?.name;
  const isConfirmationValid = confirmationText === projectName;

  if (projects === undefined) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner className="size-5 text-violet-400" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3">
          <FolderOpen className="size-6 text-gray-500" />
        </div>
        <p className="text-gray-400 text-sm">No projects yet</p>
        <p className="text-gray-600 text-xs mt-1">Create your first project to get started</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col">
        {projects.map((project) => (
          <ProjectItem
            key={project._id}
            data={project}
            onDelete={handleDeleteClick}
          />
        ))}
        {projects.length >= 6 && (
          <button
            onClick={onViewAll}
            className="flex items-center justify-center gap-2 p-4 text-gray-400 hover:text-white hover:bg-white/5 transition-all text-sm"
          >
            <span>View all projects</span>
            <Kbd className="bg-white/10 border-white/20 text-xs">⌘K</Kbd>
          </button>
        )}
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => {
        setDeleteDialogOpen(open);
        if (!open) {
          setConfirmationText("");
        }
      }}>
        <AlertDialogContent className="bg-zinc-900 border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-gray-400 space-y-4">
                <p>
                  This will permanently delete all files, conversations, and data associated with this project.
                  This action cannot be undone.
                </p>
                <div className="space-y-2">
                  <p className="text-sm">
                    Type <span className="text-white font-mono bg-white/10 px-1.5 py-0.5 rounded">{projectName}</span> to confirm:
                  </p>
                  <input
                    type="text"
                    value={confirmationText}
                    onChange={(e) => setConfirmationText(e.target.value)}
                    placeholder="Enter project name"
                    className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-md text-white placeholder:text-gray-500 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/50"
                    autoComplete="off"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              className="bg-transparent border-white/10 hover:bg-white/5"
              disabled={isDeleting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting || !isConfirmationValid}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDeleting ? (
                <>
                  <Loader2Icon className="size-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
