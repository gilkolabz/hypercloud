export const moduleInfo = {
    name: "task_manager",
    version: "1.0.0",
    description: "Simple task management system"
};

const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";

class TaskManager {
    constructor() {
        this.tasks = [];
        this.nextId = 1;
        this.storageKey = 'task_manager_tasks';
    }
    
    async load() {
        try {
            const data = await globalThis.navi.storage.item.get(this.storageKey);
            if (data) {
                const parsed = JSON.parse(data);
                this.tasks = parsed.tasks || [];
                this.nextId = parsed.nextId || 1;
            }
        } catch (error) {
            console.error('[task_manager] Failed to load tasks:', error);
            this.tasks = [];
            this.nextId = 1;
        }
    }
    
    async save() {
        try {
            const data = {
                tasks: this.tasks,
                nextId: this.nextId
            };
            await globalThis.navi.storage.item.set(this.storageKey, JSON.stringify(data));
        } catch (error) {
            console.error('[task_manager] Failed to save tasks:', error);
        }
    }
    
    add(description) {
        const task = {
            id: this.nextId++,
            description,
            completed: false,
            created: new Date().toISOString()
        };
        this.tasks.push(task);
        return task;
    }
    
    complete(id) {
        const task = this.tasks.find(t => t.id === parseInt(id));
        if (task) {
            task.completed = true;
            return task;
        }
        return null;
    }
    
    list() {
        return this.tasks;
    }
    
    remove(id) {
        const index = this.tasks.findIndex(t => t.id === parseInt(id));
        if (index !== -1) {
            return this.tasks.splice(index, 1)[0];
        }
        return null;
    }
}

const taskManager = new TaskManager();

export const commands = {
    task: {
        name: "task",
        description: "Task management: task <add|list|complete|remove> [args...]",
        execute: async (action, ...args) => {
            if (!action) {
                return [
                    "Task Manager v" + moduleInfo.version,
                    "",
                    "Usage:",
                    "  task add <description>    Add a new task",
                    "  task list                 List all tasks", 
                    "  task complete <id>        Mark task as complete",
                    "  task remove <id>          Remove a task",
                    "",
                    "Examples:",
                    "  task add \"Buy groceries\"",
                    "  task complete 1"
                ].join('\n');
            }
            
            try {
                switch (action) {
                    case 'add':
                        if (args.length === 0) {
                            return "Usage: task add <description>";
                        }
                        const description = args.join(' ');
                        const newTask = taskManager.add(description);
                        await taskManager.save();
                        return `Added task #${newTask.id}: ${newTask.description}`;
                        
                    case 'list':
                        const tasks = taskManager.list();
                        if (tasks.length === 0) {
                            return "No tasks found";
                        }
                        
                        let output = "Tasks:\n";
                        tasks.forEach(task => {
                            const status = task.completed ? '[X]' : '[ ]';
                            output += `  ${status} #${task.id}: ${task.description}\n`;
                        });
                        return output.trim();
                        
                    case 'complete':
                        if (args.length === 0) {
                            return "Usage: task complete <id>";
                        }
                        const completedTask = taskManager.complete(args[0]);
                        if (!completedTask) {
                            return `Task #${args[0]} not found`;
                        }
                        await taskManager.save();
                        return `Completed task #${completedTask.id}: ${completedTask.description}`;
                        
                    case 'remove':
                        if (args.length === 0) {
                            return "Usage: task remove <id>";
                        }
                        const removedTask = taskManager.remove(args[0]);
                        if (!removedTask) {
                            return `Task #${args[0]} not found`;
                        }
                        await taskManager.save();
                        return `Removed task #${removedTask.id}: ${removedTask.description}`;
                        
                    default:
                        return `Unknown action: ${action}. Type 'task' for help.`;
                }
            } catch (error) {
                console.error('[task_manager] Command failed:', error);
                return `Error: ${error.message || 'Unknown error'}`;
            }
        }
    }
};

function setupStdinListener() {
    if (typeof globalThis !== "undefined" && globalThis.navi && typeof globalThis.navi.on === "function") {
        globalThis.navi.on('stdin', async (input) => {
            const trimmed = input.trim();
            if (!trimmed) return;
            
            const [cmd, ...args] = trimmed.split(' ').filter(arg => arg.length > 0);
            const command = commands[cmd];
            
            if (command) {
                try {
                    const result = await command.execute(...args);
                    console.log(result);
                } catch (error) {
                    console.error("Error:", error.message || error);
                }
            }
        });
        
        console.log('[task_manager] Stdin listener ready!');
    }
}

// Initialize module
async function initialize() {
    await taskManager.load();
    setupStdinListener();
    console.log('[task_manager] Task manager module loaded');
}

initialize();

export default {
    name: "taskmanager",
    moduleInfo,
    commands,
    taskManager
};