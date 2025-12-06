#!/usr/bin/env python
r"""nc_to_json.py

将 NetCDF (ERA5) 中的一个变量导出为简单的 JSON 网格，供离线浏览器可视化使用。

用法示例：
    python nc_to_json.py g:\ERA5_Data\era5_500_850hpa_temp_20251120_6hourly_china.nc t --level 500 --out g:\temp\t_500.json

脚本将自动检测经纬坐标名（lon/lat），并在存在层维度时按最近值选择给定的层值（hPa）。
"""
import argparse
import json
import xarray as xr
import numpy as np
import os


def detect_lon_lat(ds):
    lon_name = None
    lat_name = None
    for c in ds.coords:
        cl = c.lower()
        if cl in ('longitude','lon','longitudes') and lon_name is None:
            lon_name = c
        if cl in ('latitude','lat','latitudes') and lat_name is None:
            lat_name = c
    return lon_name, lat_name


def main():
    p = argparse.ArgumentParser(description='Convert NetCDF variable to JSON grid')
    p.add_argument('infile')
    p.add_argument('varname')
    p.add_argument('--level', type=float, default=None, help='pressure level (hPa) to select if variable has level dim')
    p.add_argument('--out', default=None, help='output JSON path')
    p.add_argument('--lon', default=None, help='override longitude coordinate name')
    p.add_argument('--lat', default=None, help='override latitude coordinate name')
    args = p.parse_args()

    ds = xr.open_dataset(args.infile)

    lon_name, lat_name = detect_lon_lat(ds)
    if args.lon:
        lon_name = args.lon
    if args.lat:
        lat_name = args.lat
    if lon_name is None or lat_name is None:
        raise RuntimeError('无法检测到经度/纬度坐标，请使用 --lon 和 --lat 指定')

    if args.varname not in ds:
        # try fuzzy match: substring or common alias mapping
        candidates = list(ds.data_vars)
        lname = args.varname.lower()
        matches = [v for v in candidates if lname in v.lower() or v.lower() in lname]
        if matches:
            chosen = matches[0]
            print(f"变量 {args.varname} 不在数据集中，自动匹配到: {chosen}")
            args.varname = chosen
        else:
            # common alias map (best-effort)
            alias_map = {
                't': ['t2m','air_temperature','temperature','t'],
                'temperature': ['t2m','air_temperature','temperature'],
                't2m': ['t2m'],
                'z': ['z','geopotential','gh'],
                'geopotential': ['z','geopotential','gh'],
                'u': ['u','u10','u_component_of_wind'],
                'v': ['v','v10','v_component_of_wind'],
                'msl': ['msl','mean_sea_level_pressure']
            }
            found = None
            for k, alts in alias_map.items():
                if lname == k:
                    for a in alts:
                        if a in ds:
                            found = a
                            break
                if found:
                    break
            if found:
                print(f"变量 {args.varname} 不在数据集中，使用别名匹配到: {found}")
                args.varname = found
            else:
                raise RuntimeError(f"变量 {args.varname} 不在数据集中。可用变量: {list(ds.data_vars)}")

    da = ds[args.varname]

    # If level dim exists and user provided level, select nearest
    level_dim = None
    for c in da.coords:
        if c.lower() in ('level','isobaric','pressure','plev'):
            level_dim = c
            break

    if level_dim and args.level is not None and level_dim in da.coords:
        # choose nearest
        levels = ds.coords[level_dim].values
        # some datasets store in Pa, some in hPa; try to guess
        lv = np.array(levels, dtype=float)
        if lv.max() > 2000:  # Pa
            target = args.level * 100.0
        else:
            target = args.level
        idx = int(np.abs(lv - target).argmin())
        da_sel = da.sel({level_dim: lv[idx]}, method='nearest')
    else:
        # try dropping extra dims (time/level) by taking first
        da_sel = da
        # if more than 2 dims, attempt to index first elements
        while da_sel.ndim > 2:
            da_sel = da_sel.isel({da_sel.dims[0]: 0})

    # Ensure lat/lon are 1D coordinates
    lons = ds.coords[lon_name].values
    lats = ds.coords[lat_name].values

    arr = da_sel.values
    # If arr is (ny,nx) keep; else attempt to reshape
    if arr.ndim != 2:
        flat = arr.ravel()
        if flat.size == lats.size * lons.size:
            arr = flat.reshape((lats.size, lons.size))
        else:
            raise RuntimeError('无法将变量重塑为二维网格，维度信息: ' + str(arr.shape))

    # Convert to native Python lists for JSON
    out = {
        'lon': lons.tolist(),
        'lat': lats.tolist(),
        'values': np.array(arr).tolist(),
        'varname': args.varname,
        'attrs': {k: str(v) for k, v in ds[args.varname].attrs.items()} if hasattr(ds[args.varname], 'attrs') else {}
    }

    outpath = args.out or os.path.splitext(os.path.basename(args.infile))[0] + f'_{args.varname}.json'
    with open(outpath, 'w', encoding='utf-8') as f:
        json.dump(out, f)
    print('Wrote', outpath)


if __name__ == '__main__':
    main()
