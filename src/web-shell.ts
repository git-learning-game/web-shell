import V86Starter from "../external/v86/build/libv86.js"
import {Mutex} from "async-mutex"

class WebShell {
    private mutex: Mutex
    private emulator: any

    // Whether or not to restore the VM state from a file. Set to false to perform a regular boot.
    private restoreState = true
    private config = {
        wasm_path: "../external/v86/build/v86.wasm",
        memory_size: 64 * 1024 * 1024,
        vga_memory_size: 2 * 1024 * 1024,
        bios: {url: "./images/seabios.bin"},
        vga_bios: {url: "./images/vgabios.bin"},
        cdrom: {url: "./images/image.iso.zst"},
        disable_mouse: true,
        autostart: true,
    }
    private serialDiv: HTMLDivElement

    private prompt = "/ # "

    constructor(div?: HTMLDivElement) {
        this.mutex = new Mutex()

        if (typeof div !== "undefined") {
            let screenDiv = document.createElement("div")
            screenDiv.style.whiteSpace = "pre"
            screenDiv.style.fontFamily = "monospace"
            screenDiv.style.fontSize = "14px"
            screenDiv.style.lineHeight = "14px"

            let innerDiv = document.createElement("div")
            let canvas = document.createElement("canvas")
            canvas.style.display = "none"

            screenDiv.appendChild(innerDiv)
            screenDiv.appendChild(canvas)

            this.serialDiv = document.createElement("div")
            this.serialDiv.classList.add("serial")
            div.appendChild(screenDiv)
            div.appendChild(this.serialDiv)

            this.config["screen_container"] = screenDiv
        }

        if (this.restoreState) {
            this.config["initial_state"] = {
                url: "./images/booted-state.bin.zst",
            }
        }
    }

    async send(chars: string): Promise<void> {
        this.emulator.serial0_send(chars)
        this.serialDiv.innerText += chars
    }

    wait_for(chars: string): Promise<void> {
        return new Promise((resolve, _) => {
            let output = ""
            let listener = (char: string) => {
                if (char !== "\r") {
                    output += char
                    this.serialDiv.innerText += char
                }
                if (output.endsWith(chars)) {
                    this.emulator.remove_listener(
                        "serial0-output-char",
                        listener,
                    )
                    resolve()
                }
            }
            this.emulator.add_listener("serial0-output-char", listener)
        })
    }

    git(command: string): Promise<string> {
        return this.run(`git ${command}`)
    }

    async cd(path: string): Promise<void> {
        await this.run(`cd ${path}`)
    }

    async run(cmd: string): Promise<string> {
        let output = await this.run_unsafe(cmd)
        let exit_code = await this.run_unsafe("echo $?")
        if (exit_code != "0") {
            throw new Error(`Command '${cmd}' exited with code '${exit_code}'`)
        }
        return output
    }

    // Run a command via the serial port (/dev/ttyS0) and return the output.
    run_unsafe(
        cmd: string,
        skip_one_prompt = false,
        echo_on = true,
    ): Promise<string> {
        return new Promise(async (resolve, _) => {
            await this.mutex.acquire()
            this.emulator.serial0_send(cmd + "\n")
            if (!echo_on) {
                this.serialDiv.innerText += cmd + "\n"
            }

            var output = ""
            var listener = (char: string) => {
                if (char !== "\r") {
                    output += char
                    this.serialDiv.innerText += char
                }

                if (output.endsWith(this.prompt)) {
                    if (skip_one_prompt) {
                        skip_one_prompt = false
                        return
                    }
                    this.emulator.remove_listener(
                        "serial0-output-char",
                        listener,
                    )

                    // Remove prompt.
                    output = output.slice(0, -this.prompt.length)

                    if (echo_on) {
                        // Remove entered command.
                        output = output.slice(cmd.length + 1)
                    }

                    if (output.endsWith("\n")) {
                        output = output.slice(0, -1)
                    }

                    resolve(output)
                    this.mutex.release()
                }
            }
            this.emulator.add_listener("serial0-output-char", listener)
        })
    }

    boot(): Promise<void> {
        return new Promise((resolve, _) => {
            // Start the this.emulator!
            this.emulator = new V86Starter(this.config)

            // Wait for the this.emulator to start, then resolve the promise.
            var interval = setInterval(async () => {
                if (this.emulator.is_running()) {
                    clearInterval(interval)

                    this.prompt = "WEB_SHELL_PROMPT> "
                    await this.run_unsafe(
                        `export PS1='${this.prompt}'`,
                        true,
                        true,
                    )

                    // Set terminal width so that input lines don't wrap.
                    await this.run_unsafe("stty cols 1000", false, true)

                    resolve()
                }
            }, 100)
        })
    }
}

export default WebShell
