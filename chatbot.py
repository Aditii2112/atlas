import streamlit as st
import asyncio
import requests
import json
import re
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# --- 1. CONFIGURATION ---
server_params = StdioServerParameters(
    command="python3",
    args=["server.py"], 
)

# System Prompt teaches Gemma how to trigger the tool
TOOLS_DEFINITION = """
You are a travel assistant. You have access to a tool called 'visualize_trip'.
If the user wants a map or trip, respond ONLY with this JSON:
{"tool": "visualize_trip", "stops": ["Place A", "Place B"]}
"""

# --- 2. THE TOOL CALLER ---
async def run_mcp_tool(stops):
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await session.call_tool("visualize_trip", arguments={"stops": stops})

# --- 3. UI SETUP ---
st.set_page_config(page_title="Gemma Consultant", page_icon="🌍", layout="centered")
st.title("🤖 Gemma 4 Travel Consultant")
st.markdown("Closing the loop: Gemma now 'studies' the map results.")

if "messages" not in st.session_state:
    st.session_state.messages = []

# --- 4. THE RENDERING ENGINE ---
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        if isinstance(message["content"], list):
            for item in message["content"]:
                if item["type"] == "text":
                    st.markdown(item["text"])
                elif item["type"] == "image":
                    st.image(f"data:image/png;base64,{item['data']}")
        else:
            st.markdown(message["content"])

# --- 5. MAIN CHAT LOGIC ---
if prompt := st.chat_input("Where should we go?"):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        # A. FIRST PASS: Gemma decides to use the tool
        resp = requests.post("http://localhost:11434/api/chat", json={
            "model": "gemma4",
            "messages": [{"role": "system", "content": TOOLS_DEFINITION}, {"role": "user", "content": prompt}],
            "stream": False
        }).json()
        
        ai_response = resp['message']['content']
        match = re.search(r'\{.*\}', ai_response, re.DOTALL)
        
        if match:
            try:
                tool_data = json.loads(match.group(0))
                stops = tool_data.get("stops", [])
                
                with st.status("Planning & Consulting...", expanded=True) as status:
                    # B. EXECUTE TOOL
                    mcp_result = asyncio.run(run_mcp_tool(stops))
                    
                    display_data = []
                    tool_text_for_gemma = ""

                    # Render Map and gather text data
                    for block in mcp_result.content:
                        b_type = getattr(block, 'type', None) or block.get('type')
                        if b_type == "text":
                            b_text = getattr(block, 'text', None) or block.get('text', '')
                            st.markdown(b_text)
                            display_data.append({"type": "text", "text": b_text})
                            tool_text_for_gemma += b_text + "\n"
                        elif b_type == "image":
                            b_data = getattr(block, 'data', None) or block.get('data', '')
                            st.image(f"data:image/png;base64,{b_data}")
                            display_data.append({"type": "image", "data": b_data})

                    # C. SECOND PASS: Feed tool output BACK to Gemma
                    st.markdown("---")
                    st.write("✍️ *Gemma is reviewing the itinerary...*")
                    
                    consultation_prompt = (
                        f"The user wanted to visit {stops}. "
                        f"The mapping tool returned this data:\n{tool_text_for_gemma}\n"
                        "Based on these driving times and any warnings (skipped places), "
                        "give a brief, friendly expert travel summary. Mention if the route seems long."
                    )
                    
                    final_resp = requests.post("http://localhost:11434/api/chat", json={
                        "model": "gemma4",
                        "messages": [
                            {"role": "system", "content": "You are a professional travel consultant."},
                            {"role": "user", "content": consultation_prompt}
                        ],
                        "stream": False
                    }).json()

                    consultant_advice = final_resp['message']['content']
                    
                    # D. DISPLAY FINAL ADVICE
                    st.info(consultant_advice)
                    display_data.append({"type": "text", "text": f"\n---\n**Consultant Advice:**\n{consultant_advice}"})
                    
                    status.update(label="Consultation Complete!", state="complete")
                    st.session_state.messages.append({"role": "assistant", "content": display_data})
            
            except Exception as e:
                st.error(f"Error in Loop: {e}")
        else:
            st.markdown(ai_response)
            st.session_state.messages.append({"role": "assistant", "content": ai_response})