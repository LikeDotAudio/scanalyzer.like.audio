import pandas as pd
import json

# Read the excel file, the actual headers are on row 2 (index 1) or row 3 (index 2)?
# We tested earlier and header=2 worked.
file_path = '/home/anthony/Downloads/UCS v8.2.1 Full Translations.xlsx'
df = pd.read_excel(file_path, header=2)

# We want: Category, SubCategory, CatID, CatShort, Explanations, Synonyms - Comma Separated
cols = ['Category', 'SubCategory', 'CatID', 'CatShort', 'Explanations', 'Synonyms - Comma Separated']
df_en = df[cols].dropna(subset=['Category', 'CatID'])

ucs_list = []
for _, row in df_en.iterrows():
    ucs_list.append({
        'category': str(row['Category']).strip(),
        'subcategory': str(row['SubCategory']).strip(),
        'cat_id': str(row['CatID']).strip(),
        'cat_short': str(row['CatShort']).strip(),
        'explanation': str(row['Explanations']).strip() if pd.notna(row['Explanations']) else "",
        'synonyms': [s.strip() for s in str(row['Synonyms - Comma Separated']).split(',')] if pd.notna(row['Synonyms - Comma Separated']) else []
    })

# Save to the Rust project folder
out_path = '/home/anthony/Documents/GitProjects/Sample Analysis/sample_analyzer_rs/src/ucs_categories.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(ucs_list, f, indent=4)

print(f"Generated {out_path} with {len(ucs_list)} categories.")
