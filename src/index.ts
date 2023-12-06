
import * as L from "leaflet";
import 'leaflet/dist/leaflet.css';
import { Feature, Geometry } from "geojson";
import geobuf from "geobuf";
import Pbf from "pbf";
const $ = jQuery;

export interface FranceChoroMapOpts {
  width?: string;
  height?: string;
  data: string;
  layout: string;
  flavor?: string;
  dataResolver?: (name:string)=>string,
  mapResolver?: (name:string)=>string,
}

export interface MapData {
  data: Record<string, number>;
  colors: string[]
  labels: string[],
  layout: string
}

const identifyResolver = (name:string)=> name;

export class ChoroMap {

  opts: FranceChoroMapOpts;

  map?: L.Map;

  data?: MapData;

  element: JQuery;

  constructor(element: JQuery, opts: FranceChoroMapOpts) {
    this.opts = opts;
    this.element = element;
    element.data('map', this);
  }

  loadLayout(): Promise<GeoJSON.GeoJsonObject> {
    const mapResolver = this.opts.mapResolver ?? identifyResolver;
    const flavor = this.opts.flavor ?? 'geojson';
    if(flavor =='geojson') {
      return new Promise((resolve, reject)=> {
        const loader: JQuery.jqXHR<GeoJSON.GeoJsonObject> = $.getJSON(mapResolver(this.opts.layout));
        return loader.then(resolve).catch(reject);
      });
    } else {
      return new Promise((resolve, reject)=> {
         const url = mapResolver(this.opts.layout);
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
    
    const dataResolver = this.opts.dataResolver ?? identifyResolver;
    
    const dataLoader: JQuery.jqXHR<MapData> = $.getJSON(dataResolver(this.opts.data));

    const layoutLoader = this.loadLayout();
    
    Promise.all([dataLoader, layoutLoader]).then(results => {
      const [data, layout] = results;
      this.data = data;
      this.draw(layout, data);
    });
  }

  draw(layout: GeoJSON.GeoJsonObject, data: MapData) {
    console.log(layout, data);
   
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

    const d = new Map<string, number>(Object.entries(data.data));
    
    const colors = data.colors;

    const n_colors = data.colors.length;

    const get_value = (feature?: Feature<Geometry, any>): number|undefined =>{
      if (feature) {
        const id = feature.properties?.code;
        if (id) {
          const value = d.get('' + id);
          if (value && value >= 1  && value < n_colors) {
            return value; // Value is 1-indexed
          }
        }
      }
      return undefined;
    }

    L.geoJSON(layout, {
        style: (feature) => {
          let color = '#EEEEEE';
          const v = get_value(feature);
          if(typeof(v) !== "undefined") {
            color = colors[v - 1];;
          }
          return { 'color': color, 'stroke': false, 'fillOpacity': 0.6 }
        },
        onEachFeature: (feature, layer)=> {
          let label = feature.properties?.nom;
          const v = get_value(feature);
          if(v) {
            label += "<br/>" + data.labels[v - 1];
          }
          layer.bindPopup(label);
        }
      },
    ).addTo(map);

    const $legend = $('<div class="map-legend"/>');
    this.element.append($legend);
    
    const $s = $('<ul class="list-inline">');
    data.colors.forEach((value, index)=> {
      const label = data.labels[index];
      const $e = $('<li>');
      $e.append('<span class="label">'+ label+'</span>');
      $e.append('<span class="color" style="background-color:'+ value+'">');
      $s.append($e);
    });
    $legend.append($s);

  }

}
