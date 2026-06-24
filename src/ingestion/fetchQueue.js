// The Pure Backend in-memory FIFO queues
// These arrays strictly hold lightweight { internal_thread_id, live_version } objects.

const backgroundQueue = [];
const urgentQueue = [];

module.exports = {
    backgroundQueue,
    urgentQueue
};
