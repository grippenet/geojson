# Grippenet-maps

Little mapping library wrapping Leaflet to show France choropleth map.

It provides several features:

- Map layout and data are provided separately.
- Map layout can be provided as GeoJSON or as PBF file (gRPC serialized GeoJSON to reduce size)
- Map data can show one or several variables, each one with a given color scale (limit : all variables shares the same scale size, but labels of each colors can be differents). Map data provided already classified. Each variable value is a 1-indexed index of the color scale (original data are not needed to be in the dataset, only the color to be shown).
- For each geo feature, a data record containing attributes like variables with color scale index and can hold extra attributes (for documentation or for use into popup)
- Each map feature can show a popup, it's content can be customized with a template to show attributes values
- [Work In Progress] Data are organized into layers. For example a dataset for each time step, or for each season.
- Several color scales can be provided, either using explicit colors or using only name of internal palettes. Currently the famous ColorBrewer's from Cynthia Brewer (http://colorbrewer.org/)

## Configuration

## Map Data

Map data provides 

- List of color scales (all scales will have the same size)
- List of color palettes to use
- Variables to show. Each "variable" define the name of the attribute containing the index of the color to use in the palette for a feature
- Data layers. Each layers are independent (simplest map is with a single layer)
  - A layer provides attributes for each features(indexed by feature code in the geojson)
  - In the simplest case, the attributes only contains one entry with the color index to use for this feature.

```ts

 interface MapData {
  colors: number  // Number of colors for the palettes (all variables/palettes use the same color scale size)
  variables: Variable[] // List of variable to show
  palettes: ColorPalette[] // List of color palettes to use
  layout: string
  defaultLayer?: number; // Index of the data layer to use (0-indexed)
  layers?: LayerView[]; // List of data layers (each contain dataset with variable. For example at different time)
  defaultOpacity?: number; // Default opacity of the data (used if not provided in color palette)
}

interface LayerView {
    /**
     * Data is organized in 2 levels:
     *  - First feature code
     *  - For each feature code, an object containing data attributes. The minimal expected is an entry with the names provided
     *    in the `color` entry of variables, giving the color index (1-indexed) in the color palettes.
     */
    data: Record<string, Record<string, string | number | boolean>>
}


export interface ColorPalette {
  name?: string; // Name of palette if colors is empty
  label?: string; // Label to show in the color selector (only if several palettes are provided)
  colors?: string[] // List of colors (web color name or #hex value)
  opacity?: number; // Opacity of the data layer if this palette is selected
}

export interface Variable {
  color: string; // Name of the data attribute containing color index (1-indexed)
  title: string; // Label of the variable, to show in the selector
  popup?: string; // Template for popup content, can use {variable} syntax. {_label_} is automatically created and return color label of the area
  labels: string[]; // Labels
}

```

Examples:

For a data variables, with 2 modalities, <= 20% and > 20%. The scale color will be of size 2.
Data for a layer, only the features with code "01" and "02" are shown. `index` attribute provided for each feature code is the 1-indexed number of the color 
to use in the color scale. 

```json
{
    data: {
        "01": {
            "index": 1
        },
        "02": {
            "index": 2
        }
    }
}

```

Variables and palettes :

```json
{
  "colors": 2,
  "palettes": [
    {"name":"BuPu", "title":"Blue to Purple"},
    {"colors": ["#00FF00","#0000FF", "title":"Green/Blue"]}
  ],
  "variables": [
    { "color":"index", "title":"My variable", "labels": ["<= 20%", "> 20%"] }
  ]
}
``````