import { Controller, Get, Inject, Query } from '@nestjs/common';
import { GroupsService, type GroupNode } from './groups.service.js';

@Controller('groups')
export class GroupsController {
  constructor(@Inject(GroupsService) private readonly groups: GroupsService) {}

  @Get()
  async tree(@Query('refresh') refresh?: string): Promise<GroupNode[]> {
    return this.groups.getTree(refresh === 'true');
  }
}
