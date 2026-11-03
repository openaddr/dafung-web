#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // 诊断包落盘(#1056):系统保存对话框 + 内容 URI 写入——剪贴板对全量大包
    // 不可达(限长+大串冻结主线程),落盘后用户在文件管理器自行取件
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      // 日志插件两档都挂(#1060):构建档位切 release 后不再丢 logcat 排查通道
      // (原 cfg!(debug_assertions) 门控使 release 包原生日志静默);级别仍 Info。
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .build(),
      )?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
