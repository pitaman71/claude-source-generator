#!/usr/bin/env ts-node

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { stdout } from 'process';

// Type definitions for the command structure
interface UpdateCommand {
    update: {
        path: string;
        content: string;
        why: string;
    };
}

interface ContinueCommand {
    continue: string[];
}

interface FinishCommand {
    finish: string;
}

type Command = UpdateCommand | ContinueCommand | FinishCommand;

// Helper to check command types
function isUpdateCommand(command: Command): command is UpdateCommand {
    return 'update' in command;
}

function isContinueCommand(command: Command): command is ContinueCommand {
    return 'continue' in command;
}

function isFinishCommand(command: Command): command is FinishCommand {
    return 'finish' in command;
}

// Helper to ensure directory exists
async function ensureDirectoryExists(filePath: string): Promise<void> {
    try {
        await mkdir(dirname(filePath), { recursive: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
        }
    }
}

// Process a single command file
async function processCommandFile(filePath: string): Promise<void> {
    try {
        stdout.write(`Reading command file: ${filePath}...\n`);
        
        const fileContent = await readFile(filePath, 'utf8');
        let commands: Command[];
        
        try {
            commands = JSON.parse(fileContent);
            if (!Array.isArray(commands)) {
                throw new Error('Commands must be an array');
            }
        } catch (error) {
            stdout.write(`Error parsing JSON from ${filePath}: ${error}\n`);
            return;
        }

        for (const command of commands) {
            if (isUpdateCommand(command)) {
                const { path, content, why } = command.update;
                stdout.write(`\nProcessing file: ${path}\n`);
                stdout.write(`Reason: ${why}\n`);
                
                try {
                    await ensureDirectoryExists(path);
                    await writeFile(path, content, 'utf8');
                    stdout.write(`Successfully wrote: ${path}\n`);
                } catch (error) {
                    stdout.write(`Error writing file ${path}: ${error}\n`);
                }
            } else if (isContinueCommand(command)) {
                if (command.continue.length > 0) {
                    stdout.write('\nPending files to be processed:\n');
                    command.continue.forEach(file => stdout.write(`- ${file}\n`));
                }
            } else if (isFinishCommand(command)) {
                stdout.write('\nFinal Report:\n');
                stdout.write(`${command.finish}\n`);
                stdout.write('\nProcessing complete!\n');
            }
        }
    } catch (error) {
        stdout.write(`Error processing file ${filePath}: ${error}\n`);
    }
}

// Main execution
async function main(): Promise<void> {
    const commandFiles = process.argv.slice(2);
    
    if (commandFiles.length === 0) {
        stdout.write('Please provide at least one command file as an argument.\n');
        process.exit(1);
    }

    stdout.write(`Processing ${commandFiles.length} command file(s)...\n\n`);

    for (const file of commandFiles) {
        await processCommandFile(file);
    }
}

// Execute main and handle any uncaught errors
main().catch(error => {
    stdout.write(`Unhandled error: ${error}\n`);
    process.exit(1);
});