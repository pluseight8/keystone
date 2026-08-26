/** Mobile host boundary for R0P91 Tasks.
 *
 * The screen receives bounded projections and explicit actions. The native
 * bootstrap installs the core TaskService; this module never creates a
 * second store, reminder scheduler or calendar implementation.
 */
import type {
  CreateTaskInput,
  Task,
  TaskId,
  PersonalTaskList,
  TaskListScope,
  TaskQuery,
  TaskService,
  TaskView,
  UpdateTaskInput,
} from '@keystone/core';

export interface MobileTaskList {
  readonly id: PersonalTaskList['id'];
  readonly name: string;
  readonly scope: TaskListScope;
  readonly pinned: boolean;
  readonly memberCount: number;
}

export interface MobileTask {
  readonly id: TaskId;
  readonly listId: PersonalTaskList['id'];
  readonly title: string;
  readonly note?: string;
  readonly status: Task['status'];
  readonly priority: Task['priority'];
  readonly tags: readonly string[];
  readonly due?: Task['due'];
  readonly reminders: Task['reminders'];
  readonly parentId?: TaskId;
}

export interface MobileTaskPage {
  readonly items: readonly MobileTask[];
  readonly total: number;
  readonly nextCursor?: string;
}

export interface MobileTasksRuntime {
  lists(): Promise<readonly MobileTaskList[]>;
  tasks(options?: TaskQuery): Promise<MobileTaskPage>;
  search(query: string, options?: Omit<TaskQuery, 'query'>): Promise<MobileTaskPage>;
  previewQuickCapture(value: string, options?: { readonly locale?: 'en' | 'ru'; readonly timezone?: string }): ReturnType<TaskService['previewQuickCapture']>;
  quickCapture(value: string, options?: { readonly listId?: string; readonly locale?: 'en' | 'ru'; readonly timezone?: string }): Promise<MobileTask>;
  create(input: CreateTaskInput): Promise<MobileTask>;
  update(taskId: TaskId | string, patch: UpdateTaskInput): Promise<MobileTask>;
  complete(taskId: TaskId | string): Promise<MobileTask>;
  reopen(taskId: TaskId | string): Promise<MobileTask>;
  trash(taskId: TaskId | string): Promise<MobileTask>;
  restore(taskId: TaskId | string): Promise<MobileTask>;
  subscribe?(listener: () => void): () => void;
}

let current: MobileTasksRuntime | undefined;
const listeners = new Set<() => void>();

export function installMobileTasksRuntime(runtime: MobileTasksRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getMobileTasksRuntime(): MobileTasksRuntime | undefined { return current; }
export function subscribeMobileTasksRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

export function createMobileTasksRuntime(service: TaskService): MobileTasksRuntime {
  const projectList = (list: PersonalTaskList): MobileTaskList => ({ id: list.id, name: list.name, scope: list.scope, pinned: list.pinned, memberCount: list.members.filter(member => !member.removedAt).length });
  const projectTask = (task: Task): MobileTask => ({ id: task.id, listId: task.listId, title: task.title, ...(task.note ? { note: task.note } : {}), status: task.status, priority: task.priority, tags: task.tags, ...(task.due ? { due: task.due } : {}), reminders: task.reminders, ...(task.parentId ? { parentId: task.parentId } : {}) });
  const projectPage = async (promise: ReturnType<TaskService['listTasks']>): Promise<MobileTaskPage> => { const page = await promise; return { ...page, items: page.items.map(projectTask) }; };
  return {
    lists: async () => (await service.listLists()).map(projectList),
    tasks: options => projectPage(service.listTasks(options)),
    search: (query, options) => projectPage(service.searchTasks(query, options)),
    previewQuickCapture: (value, options) => service.previewQuickCapture(value, options),
    quickCapture: async (value, options) => projectTask(await service.quickCapture(value, options)),
    create: async input => projectTask(await service.createTask(input)),
    update: async (taskId, patch) => projectTask(await service.updateTask(taskId, patch)),
    complete: async taskId => projectTask(await service.completeTask(taskId)),
    reopen: async taskId => projectTask(await service.reopenTask(taskId)),
    trash: async taskId => projectTask(await service.deleteTask(taskId)),
    restore: async taskId => projectTask(await service.restoreTask(taskId)),
    subscribe: listener => service.subscribe(() => listener()),
  };
}

export type MobileTaskView = TaskView;
