"""Record a region of the screen, the Claude window with the pane, until a stop file appears.

    python3 scripts/demo/record.py <out.mov> <stop file> <x,y,w,h>

The region is in points from the screen's top left. macOS's screencapture records it, and stops
on a key typed at its terminal, so it runs in a pseudo-terminal and gets one once the stop file
is there (`touch` it). Run one at a time: a second recording stops the first, unsaved.
"""
import os
import pty
import sys
import time

out, stop, region = sys.argv[1:4]

pid, fd = pty.fork()
if pid == 0:
    os.execvp('screencapture', ['screencapture', '-v', '-x', '-R', region, out])

while not os.path.exists(stop):
    time.sleep(0.2)
os.write(fd, b'x')
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
