
import * as L from "leaflet";
import 'leaflet/dist/leaflet.css';
import './style.css';
import { Feature, Geometry } from "geojson";
import geobuf from "geobuf";
import Pbf from "pbf";
import { colorPalettes } from "./colors";

const $ = jQuery;

export interface FranceChoroMapOpts {
  width?: string;
  height?: string;
  data: string; // Name of the data
  layout: string; // Name of the map layout to use
  flavor?: string;
  selectorLabel?: string; // Label to use for color selector if shown
  defaultOpacity?: number; // Global default opacity for data layer
}

export interface ColorPalette {
  name?: string; // Name of palette if colors is empty
  label?: string;
  colors?: string[] // List of colors
  opacity?: number;
}

export interface Variable {
  color: string; // Name of the data attribute containing color info
  title: string;
  popup?: string; // Template for popup content, can use {variable} syntax. {_label_} is automatically created and return color label of the area
  labels: string[];
}

export type Scalar = number | string | boolean;

// List of variables/attributes available in each feature
export type LayerDataAttributes = Record<string, Scalar>;

export interface LayerView {
  data: LayerData
}

// LayerData with geographical feature id as name
export type LayerData = Record<string, LayerDataAttributes>;


// MapData as it can be loaded
export interface InputMapData {
  data?: Record<string, number> // Old fashion single data view
  colors: number | string[] 
  labels?: string[]
  variables?: Variable[] // List of variable to show
  palettes?: ColorPalette[]
  layout: string
  defaultLayer?: number;
  layers?: LayerView[]; // List of data layers (each contain dataset with variable. For example at different time)
  defaultOpacity?: number;
}

export interface MapData {
  variables: Variable[] // List of variable to show
  palettes: ColorPalette[]
  n_colors: number;
  layout: string
  layers: LayerView[]; // List of data layers (each contain dataset with variable. For example at different time)
  defaultLayer: number
  defaultOpacity?: number;
}

const regexpVars = /\{([_a-zA-z0-9]+)\}/g;

// Very simple template parser 
// Allow to bind variable with syntax {variable}
class Template {
  vars: Map<string, string> = new Map(); // placeholder {var} as key, variable name as value
  template: string;
  constructor(template: string) {
    this.template = template;
    const r = template.match(regexpVars);
    if (r) {
      r.forEach(m => {
        if(this.vars.has(m)) {
          return;
        }
        let v = m.replace(/\{|\}/g, '');
        this.vars.set(m, v);
      });
    }
  }
  bind(data: Map<string, Scalar>) {
    let txt = '' + this.template;
    this.vars.forEach((variable, placeholder) => {
      if (data.has(variable)) {
        const v = data.get(variable) ?? '';
        txt = txt.replace(placeholder, '' + v);
      }
    });
    return txt;
  }
}


const get_palette = (name: string, length: number) => {
  let p = colorPalettes.palettes[name] ?? undefined;
  if (!p) {
    return undefined;
  }
  const cc = p[length] ?? undefined;
  return cc;
}

// Internal type for layer data
type DataRecord = Map<string, Scalar>;


/**
 * DataView gives access to data with the current selected variable
 */
class DataView {
  /*
  * Data records for each feature of the map, indexed by feature code.
  * Object are transformed to Map internally
  */
  data: Map<string, DataRecord>;

  /**
   * Current variable to view
   */
  variable: Variable;

  /**
   * Template to create the popup text from attributes associated to a feature.
   * It makes variable like {var} useable, where var is a name of an attribute.
   * Attribute _label_ is automatically created 
   */
  popupTemplate?: Template;

  constructor(data: LayerData, variable: Variable) {
    this.variable = variable;
    this.data = new Map();
    Object.entries(data).forEach(e => {
      const attributes = new Map(Object.entries(e[1]));
      this.data.set(e[0], attributes);
      const color = attributes.get(variable.color);
      if(color) {
         const color_label = this.colorLabel(+color);
         attributes.set('_label_', color_label ?? ''); // placeholder {_label_} can be used to get the color label
      }
    });
    this.updateVariable();
  }

  setVariable(v: Variable) {
    this.variable = v;
    this.updateVariable();
  }


  updateVariable() {
    if (this.variable.popup) {
      this.popupTemplate = new Template(this.variable.popup);
    } else {
      this.popupTemplate = undefined;
    }
  }

  getColorLabels(): string[] {
    return this.variable.labels;
  }

  /**
   * Get color label at index (index is 1-indexed, not 0)
   * @param index 1-indexed color value index
   * @returns 
   */
  colorLabel(index: number): string | undefined {
    if(!this.variable.labels || !index) {
      return undefined;
    }
    if(index > 0 && index <= this.variable.labels.length) {
      return this.variable.labels[index - 1];
    }
    return undefined;
  }

  /**
   * Get a data record associated to a feature, from its feature code.
   * @param feature 
   * @returns 
   */
  getRecord(feature?: Feature<Geometry, any>): DataRecord | undefined {
    if (feature) {
      const id = feature.properties?.code;
      if (id) {
        const record = this.data.get('' + id);
        if (record) {
          return record;
        }
      }
    }
    return undefined;
  }

  getColorValue(feature?: Feature<Geometry, any>): number | undefined {
    const record = this.getRecord(feature);
    if (record) {
      const n = this.variable.color;
      const v = record.get(n);
      if (typeof (v) !== "undefined") {
        return +v;
      }
    }
    return undefined;
  }

  getPopupContent(feature?: Feature<Geometry, any>): string {
    if (this.popupTemplate) {
      const record = this.getRecord(feature);
      if(record) {
        const v = this.popupTemplate.bind(record);
        return v;
      }
    }
    // If not popup template only shows the color label
    const v = this.getColorValue(feature);
    if (v) {
      console.log('color value', v, feature, this);
      return '' + this.colorLabel(v);
    }
    return '';
  }
}


export class ChoroMap {

  opts: FranceChoroMapOpts;

  map?: L.Map;

  data?: MapData;

  element: JQuery;

  dataView?: DataView;

  dataLayerIndex: number = 0;

  variableIndex: number = 0;

  palette: number; // Current palette

  palettes: ColorPalette[];

  layer?: L.GeoJSON;

  constructor(element: JQuery, opts: FranceChoroMapOpts) {
    this.opts = opts;
    this.element = element;
    this.dataView = undefined;
    this.palette = 0;
    this.palettes = [];
    element.data('map', this);
  }

  loadLayout(): Promise<GeoJSON.GeoJsonObject> {
    const flavor = this.opts.flavor ?? 'geojson';
    if (flavor == 'geojson') {
      return new Promise((resolve, reject) => {
        const loader: JQuery.jqXHR<GeoJSON.GeoJsonObject> = $.getJSON(this.opts.layout);
        return loader.then(resolve).catch(reject);
      });
    } else {
      return new Promise((resolve, reject) => {
        const url = this.opts.layout;
        const p = fetch(url);
        p.then(r => {
          r.arrayBuffer().then(data => {
            const geo = geobuf.decode(new Pbf(data));
            resolve(geo);
          }).catch(reject);
        }).catch(reject);
      });
    }
  }

  /**
   * Load trigger the map to load layout and data and shows
   * @returns 
   */
  load() {
    const dataLoader: JQuery.jqXHR<InputMapData> = $.getJSON(this.opts.data);
    const layoutLoader = this.loadLayout();

    return Promise.all([dataLoader, layoutLoader]).then(results => {
      const [data, layout] = results;
      this.importData(data);
      this.buildPalettes();
      this.draw(layout);
    });
  }

  /**
   * Import data once loaded and normalize data to a stable record. Only for compat with non layered format
   * @param input 
   * @returns 
   */
  importData(input: InputMapData) {

    var variables: Variable[];
    var layers: LayerView[];
    var defaultLayer: number = 0;
    var palettes: ColorPalette[] = [];
    var n_colors: number = 0;
    if (input.data) {
      variables = [{ 'color': 'c', labels: input.labels ?? [], title: "" }];
      const d: LayerData = {};
      Object.entries(input.data).forEach(e => {
        const id = e[0];
        const v = e[1];
        d[id] = { 'c': v };
      });
      layers = [{
        data: d
      }];
    } else {
      variables = input.variables ?? [];
      layers = input.layers ?? [];
    }

    if (Array.isArray(input.colors)) {
      palettes = [{ colors: input.colors }];
      n_colors = input.colors.length;
    } else {
      n_colors = input.colors;
    }

    if (input.palettes) {
      palettes = input.palettes;
    }

    this.palette = 0;
    if (layers.length == 0) {
      console.error("Unable to create view, no data layer");
      return;
    }

    if (variables.length == 0) {
      console.error("Unable to create view, no variable");
      return;
    }

    this.data = {
      variables: variables, // List of variable to show
      palettes: palettes,
      n_colors: n_colors,
      layout: input.layout,
      layers: layers,
      defaultLayer: defaultLayer,
      defaultOpacity: input.defaultOpacity
    };

    this.dataLayerIndex = defaultLayer;
    this.variableIndex = 0;

    this.dataView = new DataView(layers[defaultLayer].data, variables[this.variableIndex]);
  }

  /**
   * Creates palettes from definition. If only name is given resolve the color list using the number of colors requested in spec
   * @returns 
   */
  buildPalettes() {
    if (!this.data) {
      return;
    }
    const n_colors = this.data.n_colors;
    if (this.data.palettes) {
      this.data.palettes.forEach((def, index) => {
        if (def.colors) {
          this.palettes.push(def);
        } else {
          if (def.name) {
            const cc = get_palette(def.name, n_colors);
            if (cc) {
              def.colors = cc;
              this.palettes.push(def);
            } else {
              console.warn("Unknown palette " + def.name + ":" + n_colors + "for palette " + index);
            }
          }
        }
      });
    }
  }

  draw(layout: GeoJSON.GeoJsonObject) {

    if (!this.data) {
      return;
    }

    const $m = $('<div>');
    if (this.opts.width) {
      $m.css('width', this.opts.width + 'px');
    }
    if (this.opts.height) {
      $m.css('height', this.opts.height + 'px');
    }

    if (this.data.variables.length > 1) {
      const $varSelect = $('<ul class="map-vars">');
      this.data.variables.forEach((variable, index) => {
        const $v = $('<li class="map-var map-var-' + index + '">');
        $v.data('index', index);
        $v.append(variable.title);
        if (index == this.variableIndex) {
          $v.addClass('active');
        }
        $v.on('click', () => {
          this.selectVariable(index);
        });
        $varSelect.append($v);
      });
      this.element.append($varSelect);
    }

    this.element.append($m);
    this.element.addClass('map-figure');

    const map = L.map($m.get()[0], { 'zoom': 6, center: [46.71109, 1.7191036] });

    this.map = map;

    L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      subdomains: ['a', 'b', 'c'],
    }).addTo(map);

    this.layer = L.geoJSON(layout, {
      onEachFeature: (feature, layer) => {
        layer.bindPopup((_l: L.Layer) => {
          return this.getPopupContent(feature);
        });
      }
    },
    ).addTo(map);

    if (this.palettes.length > 1) {
      const $cs = $('<div class="map-color-selector">');
      const $s = $('<select class="map-palettes">');
      this.palettes.forEach((p, index) => {
        const $o = $('<option value="' + index + '">');
        const label = (p.label ? p.label : p.name) ?? 'Palette ' + index;
        $o.text(label);
        $s.append($o);
      });
      const self = this;
      $s.on('change', function () {
        self.palette = +($(this).val() ?? 0);
        self.updateStyle();
      });
      $cs.append('<label class="map-selector-label me-1">' + (this.opts.selectorLabel ?? 'Choose color') + '</label>');
      $cs.append($s);
      this.element.append($cs);
    }

    const $legend = $('<div class="map-legend"/>');
    this.element.append($legend);

    this.updateStyle();
  }

  getPopupContent(feature?: Feature<Geometry, any>): string {
    if (!this.dataView) {
      return '';
    }
    let label = feature?.properties?.nom;
    const v = this.dataView.getPopupContent(feature);
    return '<div class="map-popup-content"><div class="feature-label">' + label +'</div><div class="popup-data-content">' + v +'</div></div>';
  }

  getValue(feature?: Feature<Geometry, any>): number | undefined {
    return this.dataView ? this.dataView.getColorValue(feature) : undefined;
  }

  selectVariable(index: number) {
    if (!this.data || !this.dataView) {
      return;
    }
    if (index >= 0 && index <= this.data.variables.length - 1) {
      this.variableIndex = index;
      this.dataView.setVariable(this.data.variables[index]);
      this.updateStyle();
    }
  }

  updateStyle() {

    if (!this.data || !this.dataView) {
      return;
    }

    if (!this.layer) {
      return;
    }

    const defaultOpacity = () => {
      if (this.data?.defaultOpacity) {
        return this.data.defaultOpacity;
      }
      if (this.opts.defaultOpacity) {
        return this.opts.defaultOpacity;
      }
      return 0.6;
    }

    let colors: string[];
    let fillOpacity = defaultOpacity();

    try {
      const p = this.palettes[this.palette];
      if (p && p.colors) {
        colors = p.colors;
        if (p.opacity) {
          fillOpacity = p.opacity;
        }
      } else {
        console.warn("No useable palette found");
        return;
      }
    } catch (e) {
      console.warn("Unable to use palette " + this.palette);
      return;
    }

    const n_colors = colors.length;

    this.layer.setStyle((feature) => {
      let color = '#EEEEEE';
      const v = this.getValue(feature);
      if (typeof (v) !== "undefined") {
        if (v >= 1 && v <= n_colors) { // Value must be 1-indexed
          color = colors[v - 1];
        }
      }
      return { 'color': color, 'stroke': false, 'fillOpacity': fillOpacity }
    });

    const $legend = this.element.find('.map-legend');
    $legend.empty();
    const $s = $('<ul class="list-inline">');
    const labels = this.dataView.getColorLabels();
    colors.forEach((value, index) => {
      const label = labels[index];
      const $e = $('<li>');
      $e.append('<span class="label">' + label + '</span>');
      $e.append('<span class="color" style="background-color:' + value + '">');
      $s.append($e);
    });
    $legend.append($s);

    const $vars = this.element.find('.map-vars');
    $vars.find('.active').removeClass('active');
    $vars.find('.map-var-' + this.variableIndex).addClass('active');

  }

}
