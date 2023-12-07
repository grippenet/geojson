
import * as L from "leaflet";
import 'leaflet/dist/leaflet.css';
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
  selectorLabel?:string; // Label to use for color selector if shown
  defaultOpacity?: number; // Global default opacity for data layer
}

export interface ColorPalette {
  name?: string; // Name of palette if colors is empty
  label?: string;
  colors?: string[] // List of colors
  opacity?:number;
}

export interface MapData {
  data: Record<string, number>
  colors: number|string[]
  labels: string[]
  palettes?: ColorPalette[]
  layout: string
  defaultOpacity?: number;
}

const get_palette = (name:string, length:number) =>{
  let p = colorPalettes.palettes[name] ?? undefined;
  if(!p) {
    return undefined;
  }
    const cc = p[length] ?? undefined;
    return cc;
}


export class ChoroMap {

  opts: FranceChoroMapOpts;

  map?: L.Map;

  data?: MapData;

  element: JQuery;

  dataValues: Map<string, number>;

  palette: number; // Current palette

  palettes: ColorPalette[];

  layer?: L.GeoJSON;

  constructor(element: JQuery, opts: FranceChoroMapOpts) {
    this.opts = opts;
    this.element = element;
    this.dataValues = new Map();
    this.palette = 0;
    this.palettes = [];
    element.data('map', this);
  }

  loadLayout(): Promise<GeoJSON.GeoJsonObject> {
    const flavor = this.opts.flavor ?? 'geojson';
    if(flavor =='geojson') {
      return new Promise((resolve, reject)=> {
        const loader: JQuery.jqXHR<GeoJSON.GeoJsonObject> = $.getJSON(this.opts.layout);
        return loader.then(resolve).catch(reject);
      });
    } else {
      return new Promise((resolve, reject)=> {
         const url = this.opts.layout;
         const p = fetch(url);
         p.then(r=>{
            r.arrayBuffer().then(data => {
                const geo = geobuf.decode(new Pbf(data));
                resolve(geo);
            }).catch(reject);
         }).catch(reject);
      });
    }
  }


  load() {
    const dataLoader: JQuery.jqXHR<MapData> = $.getJSON(this.opts.data);
    const layoutLoader = this.loadLayout();
    
    Promise.all([dataLoader, layoutLoader]).then(results => {
      const [data, layout] = results;
      this.data = data;
      this.dataValues = new Map<string, number>(Object.entries(data.data));
      this.buildPalettes();
      this.draw(layout, data);
    });
  }

  buildPalettes() {
    if(!this.data) {
      return;
    }
    this.palette = 0; // Default palette is always first
    // If colors provided as array, then only single palette
    if(Array.isArray(this.data.colors)) {
      this.palettes = [{colors: this.data.colors}];
      this.palette = 0;
      return;
    }
    const n_colors = this.data.colors;
    if(this.data.palettes) {
      this.data.palettes.forEach((def, index)=>{
          if(def.colors) {
            this.palettes.push(def);
          } else {
            if(def.name) {
              const cc = get_palette(def.name, n_colors);
              if(cc) {
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

  draw(layout: GeoJSON.GeoJsonObject, data: MapData) {

    const $m = $('<div>');
    if(this.opts.width) {
      $m.css('width', this.opts.width + 'px');
    }
    if(this.opts.height) {
      $m.css('height', this.opts.height + 'px');
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
        onEachFeature: (feature, layer)=> {
          let label = feature.properties?.nom;
          const v = this.getValue(feature);
          if(v) {
            label += "<br/>" + data.labels[v - 1];
          }
          layer.bindPopup(label);
        }
      },
    ).addTo(map);

    if(this.palettes.length > 1) {
      const $s = $('<select class="map-palettes">');
      this.palettes.forEach((p, index) => {
        const $o = $('<option value="'+index+'">');
        const label = (p.label ? p.label : p.name) ?? 'Palette ' + index;
        $o.text(label);
        $s.append($o);
      });
      const self = this;
      $s.on('change', function() {
        self.palette = +($(this).val() ?? 0);
        self.updateStyle();
      });
      this.element.append('<label class="map-selector-label me-1">'+ (this.opts.selectorLabel ?? 'Choose color') + '</label>');
      this.element.append($s);
    }

    const $legend = $('<div class="map-legend"/>');
    this.element.append($legend);

    this.updateStyle();
  }

  getValue(feature?: Feature<Geometry, any>): number|undefined {
    if (feature) {
      const id = feature.properties?.code;
      if (id) {
        return this.dataValues.get('' + id);
      }
    }
    return undefined;
  }

  
  updateStyle() {
    
    if(!this.data) {
      return;
    }

    if(!this.layer) {
      return;
    }

    const defaultOpacity = () => {
      if(this.data?.defaultOpacity) {
        return this.data.defaultOpacity;
      }
      if(this.opts.defaultOpacity) {
        return this.opts.defaultOpacity;
      }
      return 0.6;
    }

    let colors: string[];
    let fillOpacity = defaultOpacity();

    try {
      const p = this.palettes[this.palette];
      if(p && p.colors) {
        colors = p.colors;
        if(p.opacity) {
          fillOpacity = p.opacity;
        }
      } else {
        console.warn("No useable palette found");
        return;
      }
    } catch(e) {
      console.warn("Unable to use palette "+ this.palette);
      return;
    }
    
    const n_colors = colors.length;

    this.layer.setStyle((feature) => {
      let color = '#EEEEEE';
      const v = this.getValue(feature);
      if(typeof(v) !== "undefined") {
        if(v >= 1 && v <= n_colors) { // Value must be 1-indexed
          color = colors[v - 1];
        }
      }
        return { 'color': color, 'stroke': false, 'fillOpacity': fillOpacity }
      });

      const $legend = this.element.find('.map-legend');
      $legend.empty();
      const $s = $('<ul class="list-inline">');
      const labels = this.data.labels;
      colors.forEach((value, index)=> {
        const label = labels[index];
        const $e = $('<li>');
        $e.append('<span class="label">'+ label+'</span>');
        $e.append('<span class="color" style="background-color:'+ value+'">');
        $s.append($e);
      });
      $legend.append($s);

  }

}
