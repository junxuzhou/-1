# ERA5 Web 可视化（离线工作流）

目的：在无外网或受限网络环境中使用浏览器可视化 ERA5 NetCDF 数据。

步骤 A：将 NetCDF 转为 JSON（只需执行一次，使用 Python）

1. 创建并激活 Python 环境（建议用 conda + xarray 或直接使用已有 Python 能读取 NetCDF）：

```powershell
conda activate your_env
pip install xarray netcdf4 numpy
```

2. 使用仓库中的转换脚本把变量导出为 JSON（示例）：

```powershell
python g:\era5_web_viz\nc_to_json.py g:\ERA5_Data\raw\single_levels\era5_simple_test_20200101.nc t --level 500 --out g:\era5_web_viz\demo_t500.json
```

这会生成包含 `lon`, `lat`, `values` 的 JSON 文件。

步骤 B：下载前端依赖到本地（仅需一次，若网络允许）

在 PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File g:\era5_web_viz\download_vendors.ps1
```

脚本会把必要的 JS/CSS 保存到 `g:\era5_web_viz\vendor\`。若网络不可用，可在能联网的机器执行后拷贝 `vendor` 文件夹。

步骤 C：打开本地页面并加载 JSON

1. 在浏览器中打开 `file:///g:/era5_web_viz/index.html` 或在项目目录启动本地服务器并打开 `http://localhost:8000/era5_web_viz/index.html`。
2. 在页面上点 “选择文件”，选择生成的 `demo_t500.json`（或直接选择 NetCDF 若你的浏览器支持但不建议在离线情形）。
3. 从下拉菜单选择变量并点击“生成图表”。

注意
- 该前端为离线最小实现，功能会逐步增强（增加图例、层选择、PNG 导出等）。
- 若你不愿意安装 Python，本项目的 `vendor` 脚本可在另一台可联网机器运行后将 `vendor` 目录拷回当前机器使用。
