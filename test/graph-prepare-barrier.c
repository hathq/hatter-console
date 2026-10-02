/* Hatter 2026: test-only syscall barrier. The real fsync always executes.
 * No fake result, rewritten source, canonical mutation or product fault switch.
 * Only an exact owned Hatter executable and sem-lang snapshot directory match.
 * FD3 reports the durable preparation; FD4 releases its return to the caller. */
#define _GNU_SOURCE
#include <errno.h>
#include <limits.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

int fsync(int fd) {
    int result = (int)syscall(SYS_fsync, fd);
    int saved = errno;
    const char *binary = getenv("HATTER_GRAPH_BARRIER_BINARY");
    const char *directory = getenv("HATTER_GRAPH_BARRIER_DIRECTORY");
    static atomic_bool reached = 0;
    char executable[PATH_MAX], descriptor[64], target[PATH_MAX];
    if (result == 0 && binary && directory && !atomic_load(&reached)) {
        ssize_t length = readlink("/proc/self/exe", executable, sizeof(executable)-1);
        if (length > 0) {
            executable[length] = 0;
            snprintf(descriptor, sizeof(descriptor), "/proc/self/fd/%d", fd);
            length = readlink(descriptor, target, sizeof(target)-1);
            if (length > 0 && strcmp(binary, executable) == 0) {
                target[length] = 0;
                size_t prefix = strlen(directory);
                if (strncmp(target, directory, prefix) == 0 && target[prefix] == '/'
                    && strncmp(target+prefix+1, "runtime-", 8) == 0
                    && strstr(target+prefix+1, ".tmp-") && !atomic_exchange(&reached, 1)) {
                    char release;
                    if (write(3, target, (size_t)length) != length || write(3, "\n", 1) != 1)
                        _exit(91);
                    ssize_t count;
                    do { count = read(4, &release, 1); } while (count < 0 && errno == EINTR);
                    if (count != 1 || release != 'R') _exit(92);
                }
            }
        }
    }
    errno = saved;
    return result;
}
