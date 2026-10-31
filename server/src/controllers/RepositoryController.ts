import { Response } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../config/db';
import { accessControl } from '../services/AccessControl';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

export class RepositoryController {
  // GET /projects (FR-01.5, Sequence Diagram 3 steps 8-9)
  public async listProjects(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const username = req.user!.username;

      const memberships = await prisma.projectMembership.findMany({
        where: { username },
        include: { project: true }
      });

      const projects = memberships.map((m) => ({
        id: m.project.id,
        name: m.project.name,
        mainFile: m.project.mainFile,
        sizeBytes: m.project.sizeBytes,
        role: m.role
      }));

      res.status(200).json({ projects });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error while listing projects.' });
    }
  }

  // POST /projects (FR-01.1, UC-05)
  public async createProject(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const username = req.user!.username;
      const { name } = req.body;

      // 1. Validate project name length: 1 to 100 characters (FR-01.1)
      if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100) {
        res.status(400).json({
          error: 'Project name must be between 1 and 100 characters long.'
        });
        return;
      }

      const trimmedName = name.trim();

      // 2. Check uniqueness among the user's owned projects (FR-01.1, UC-05 flow 2a)
      const existingOwned = await prisma.projectMembership.findFirst({
        where: {
          username,
          role: Role.OWNER,
          project: { name: trimmedName }
        }
      });

      if (existingOwned) {
        res.status(400).json({
          error: 'You already have a project with this name. Please choose a unique name.'
        });
        return;
      }

      // 3. Create project with main.tex and assign OWNER role (FR-01.1)
      const project = await prisma.project.create({
        data: {
          name: trimmedName,
          mainFile: 'main.tex',
          sizeBytes: 0,
          hasServerCopy: true,
          memberships: {
            create: {
              username,
              role: Role.OWNER
            }
          }
        }
      });

      res.status(201).json({
        id: project.id,
        name: project.name,
        mainFile: project.mainFile,
        role: Role.OWNER
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error while creating project.' });
    }
  }

  // PUT /projects/:id/files (FR-01.2, FR-01.3, FR-01.6 server-side role enforcement)
  public async updateProjectFiles(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const username = req.user!.username;
      const projectId = String(req.params.id);

      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      // Server-side independent role check (FR-01.6)
      const canEdit = await accessControl.canEditFiles(username, projectId);
      if (!canEdit) {
        res.status(403).json({
          error: 'Action refused: Your role (VIEWER or non-member) does not permit editing or saving project files.'
        });
        return;
      }

      res.status(200).json({
        message: 'Project files updated successfully.',
        projectId
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error while updating project files.' });
    }
  }

  // DELETE /projects/:id (FR-01.4, FR-01.6, UC-09)
  public async deleteProject(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const username = req.user!.username;
      const projectId = String(req.params.id);

      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      // Only the OWNER can permanently delete a project (FR-01.4, FR-01.6)
      const isOwner = await accessControl.isOwner(username, projectId);
      if (!isOwner) {
        res.status(403).json({
          error: 'Action refused: Only the project Owner is permitted to delete this project.'
        });
        return;
      }

      await prisma.project.delete({
        where: { id: projectId }
      });

      res.status(200).json({
        message: 'Project permanently deleted.'
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error while deleting project.' });
    }
  }
}

export const repositoryController = new RepositoryController();
