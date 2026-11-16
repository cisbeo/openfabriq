"""Runs a command in a pseudo-terminal, 100 columns by 40 rows, as a terminal app would.

What the test writes to stdin is typed into it; what it prints comes out on stdout. Exits with the
command's code. Used by terminal.ts: `script` refuses a stdin that is not a terminal on macOS.
"""
import fcntl, os, pty, select, struct, sys, termios

pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))
inputs = [fd, sys.stdin.fileno()]
while True:
    ready, _, _ = select.select(inputs, [], [])
    if fd in ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(sys.stdout.fileno(), data)
    if sys.stdin.fileno() in ready:
        data = os.read(sys.stdin.fileno(), 65536)
        if data:
            os.write(fd, data)
        else:
            inputs.remove(sys.stdin.fileno())
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
