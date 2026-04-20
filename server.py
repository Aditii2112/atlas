import os
import base64
import requests
import urllib.parse
import time
from mcp.server.fastmcp import FastMCP, Image
from dotenv import load_dotenv

load_dotenv()

mcp = FastMCP("GlobalTravelPlanner")

@mcp.tool()
def visualize_trip(stops: list[str]):
    API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not API_KEY:
        return "Error: API Key missing."

    # --- STEP 1: VALIDATION (Strict Checking) ---
    valid_stops = []
    skipped_stops = []

    # Get start point for radius bias (prevents the 'Costa Rica' jump)
    first_geo = requests.get(f"https://maps.googleapis.com/maps/api/geocode/json?address={urllib.parse.quote(stops[0])}&key={API_KEY}").json()
    lat, lng = None, None
    if first_geo.get("status") == "OK":
        loc = first_geo['results'][0]['geometry']['location']
        lat, lng = loc['lat'], loc['lng']

    for stop in stops:
        # Bias results to be near your starting point
        bias = f"&location={lat},{lng}&radius=50000" if lat else ""
        geo_url = f"https://maps.googleapis.com/maps/api/geocode/json?address={urllib.parse.quote(stop)}{bias}&key={API_KEY}"
        geo_data = requests.get(geo_url).json()
        
        if geo_data.get("status") == "OK":
            valid_stops.append(geo_data['results'][0]['formatted_address'])
        else:
            skipped_stops.append(stop)

    if len(valid_stops) < 2:
        return f"Error: Only {len(valid_stops)} valid locations found. Skipped: {skipped_stops}"

    # --- STEP 2: OPTIMIZATION ---
    origin_raw = valid_stops[0]
    order_url = f"https://maps.googleapis.com/maps/api/directions/json?origin={urllib.parse.quote(origin_raw)}&destination={urllib.parse.quote(origin_raw)}&waypoints=optimize:true|{urllib.parse.quote('|'.join(valid_stops[1:]))}&key={API_KEY}"
    order_resp = requests.get(order_url).json()

    if order_resp.get("status") == "OK":
        optimized_indices = order_resp['routes'][0]['waypoint_order']
        ordered_waypoints = [valid_stops[1:][i] for i in optimized_indices]
        master_list = [valid_stops[0]] + ordered_waypoints + [valid_stops[0]]
    else:
        master_list = valid_stops

    # --- STEP 3: CHUNKING & RENDERING ---
    chunk_size = 6
    chunks = [master_list[i:i + chunk_size] for i in range(0, len(master_list), chunk_size - 1)]
    
    final_output = []
    total_travel_minutes = 0

    for idx, leg_stops in enumerate(chunks):
        if len(leg_stops) < 2: continue
        
        leg_origin, leg_dest = leg_stops[0], leg_stops[-1]
        leg_url = f"https://maps.googleapis.com/maps/api/directions/json?origin={urllib.parse.quote(leg_origin)}&destination={urllib.parse.quote(leg_dest)}&waypoints={urllib.parse.quote('|'.join(leg_stops[1:-1]))}&key={API_KEY}"
        leg_data = requests.get(leg_url).json()
        
        if leg_data.get("status") == "OK":
            route = leg_data['routes'][0]
            total_travel_minutes += sum(l['duration']['value'] for l in route['legs']) // 60
            
            # Static Map generation
            color = "blue" if idx % 2 == 0 else "red"
            markers = "".join([f"&markers=color:{color}|label:{chr(65+i)}|{urllib.parse.quote(s)}" for i, s in enumerate(leg_stops)])
            path = f"&path=weight:5|color:{color}|enc:{route['overview_polyline']['points']}"
            img_bytes = requests.get(f"https://maps.googleapis.com/maps/api/staticmap?size=600x400&scale=2{markers}{path}&key={API_KEY}").content
            
            # Link generation
            maps_link = f"https://www.google.com/maps/dir/{'/'.join([urllib.parse.quote(s) for s in leg_stops])}"
            
            final_output.append(f"### Leg {idx+1}: {leg_origin} ➔ {leg_dest}\n🔗 [Open Leg {idx+1}]({maps_link})")
            final_output.append(Image(data=img_bytes, format="png"))

    # --- STEP 4: SUMMARY & SKIPPED PLACES ---
    total_h, total_m = divmod(total_travel_minutes, 60)
    summary = f"## ✅ Journey Optimized\n**Total Driving Time:** {total_h}h {total_m}m"
    
    if skipped_stops:
        summary += f"\n\n⚠️ **Warning: Locations Skipped**\nGoogle Maps couldn't find: *{', '.join(skipped_stops)}*"

    final_output.insert(0, summary + "\n---")
    return final_output

if __name__ == "__main__":
    mcp.run()