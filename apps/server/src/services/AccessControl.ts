import { Role } from '@prisma/client';
import { prisma } from '../config/db';

export class AccessControl {
  // CD-4d: roleOf(user, project) : Role | null
  public async roleOf(username: string, projectId: string): Promise<Role | null> {
    const membership = await prisma.projectMembership.findUnique({
      where: {
        username_projectId: {
          username,
          projectId
        }
      }
    });
    return membership ? membership.role : null;
  }

  // CD-4d: isOwner(user, project) : boolean
  public async isOwner(username: string, projectId: string): Promise<boolean> {
    const role = await this.roleOf(username, projectId);
    return role === Role.OWNER;
  }

  // CD-4d: isMember(user, project) : boolean
  public async isMember(username: string, projectId: string): Promise<boolean> {
    const role = await this.roleOf(username, projectId);
    return role !== null;
  }

  // CD-4d: canEditFiles(user, project) : boolean (OWNER or EDITOR)
  public async canEditFiles(username: string, projectId: string): Promise<boolean> {
    const role = await this.roleOf(username, projectId);
    return role === Role.OWNER || role === Role.EDITOR;
  }

  // CD-4d: canEdit(user, project) : boolean (OWNER or EDITOR)
  public async canEdit(username: string, projectId: string): Promise<boolean> {
    const role = await this.roleOf(username, projectId);
    return role === Role.OWNER || role === Role.EDITOR;
  }
}

export const accessControl = new AccessControl();
