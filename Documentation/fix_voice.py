import json
import os
import glob

def process_file(path):
    try:
        with open(path, 'r') as f:
            data = json.load(f)
        
        changed = False
        for item in data:
            # If group is Vocal, rename to Voice
            if item.get("group") == "Vocal":
                item["group"] = "Voice"
                changed = True
            
            # If group is Voice, set timbre to Voice (and rename in subgroup if needed)
            if item.get("group") == "Voice":
                if item.get("timbre") != "Voice":
                    item["timbre"] = "Voice"
                    changed = True
                
                # Check subgroup as well
                subgroup = item.get("subgroup", "")
                if "Vocal" in subgroup:
                    item["subgroup"] = subgroup.replace("Vocal", "Voice")
                    changed = True
                    
        if changed:
            with open(path, 'w') as f:
                json.json(data, f, indent=2) # Actually json.dump
            print(f"Updated {path}")
    except Exception as e:
        print(f"Error on {path}: {e}")

for filepath in glob.glob("**/*.peak", recursive=True):
    process_file(filepath)
