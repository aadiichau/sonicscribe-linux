fn main() {
    // WebKitGTK's DMA-BUF renderer shows a blank window on many NVIDIA + Wayland setups.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // SAFETY: single-threaded at this point; nothing else reads the environment yet.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
    sonicscribe_lib::run();
}
